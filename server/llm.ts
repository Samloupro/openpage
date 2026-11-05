/**
 * server/llm.ts
 *
 * Owns: provider resolution from the environment, the two request shapes
 * (Google Gemini, any OpenAI-compatible /chat/completions such as OmniRoute or
 * OpenRouter), JSON extraction from a completion, and model listing.
 *
 * Open when: the API middleware or a serverless function needs a model.
 *
 * Never: import from src/ (so it stays out of the app bundle), return an API
 * key to a caller, or accept a caller-supplied base URL.
 */

export type LlmProvider = 'gemini' | 'openai'

export interface LlmConfig {
  provider: LlmProvider
  model: string
  baseUrl?: string
  apiKey?: string
}

export interface LlmPublicStatus {
  configured: boolean
  provider: LlmProvider | null
  model: string | null
  baseUrl: string | null
  hasKey: boolean
}

export class LlmError extends Error {
  readonly code: string
  readonly status: number

  constructor(code: string, message: string, status = 502) {
    super(message)
    this.name = 'LlmError'
    this.code = code
    this.status = status
  }
}

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta'
const DEFAULT_GEMINI_MODEL = 'gemini-3-flash-preview'
const DEFAULT_OPENAI_MODEL = 'openrouter/auto'
const DEFAULT_TIMEOUT_MS = 90_000

function trimSlash(value: string): string {
  return value.replace(/\/+$/, '')
}

/**
 * Reads OPENPAGE_LLM_* first, then GEMINI_API_KEY. Returns null when nothing is
 * configured, which the API surfaces as 501 so the client can fall back.
 *
 * OPENPAGE_LLM_PROVIDER wins when set; otherwise an OpenAI-compatible endpoint
 * is assumed as soon as a base URL or a key is present.
 */
export function readLlmConfig(env: NodeJS.ProcessEnv = process.env): LlmConfig | null {
  const declared = (env.OPENPAGE_LLM_PROVIDER ?? '').trim().toLowerCase()
  const baseUrl = trimSlash((env.OPENPAGE_LLM_BASE_URL ?? '').trim())
  const apiKey = (env.OPENPAGE_LLM_API_KEY ?? '').trim()
  const model = (env.OPENPAGE_LLM_MODEL ?? '').trim()

  const provider: LlmProvider =
    declared === 'gemini' || declared === 'openai'
      ? declared
      : baseUrl || apiKey
        ? 'openai'
        : 'gemini'

  if (provider === 'gemini') {
    const key = (env.GEMINI_API_KEY ?? '').trim() || (declared === 'gemini' ? apiKey : '')
    if (!key) return null
    return { provider, apiKey: key, model: model || DEFAULT_GEMINI_MODEL }
  }

  if (!baseUrl || !apiKey) return null
  if (!/^https?:\/\//i.test(baseUrl)) {
    throw new LlmError(
      'invalid_config',
      `OPENPAGE_LLM_BASE_URL must be an http(s) URL, got "${baseUrl}"`,
      500,
    )
  }

  return { provider, apiKey, baseUrl, model: model || DEFAULT_OPENAI_MODEL }
}

export function publicStatus(config: LlmConfig | null): LlmPublicStatus {
  if (!config) {
    return { configured: false, provider: null, model: null, baseUrl: null, hasKey: false }
  }
  return {
    configured: true,
    provider: config.provider,
    model: config.model,
    baseUrl: config.provider === 'openai' ? (config.baseUrl ?? null) : GEMINI_BASE,
    hasKey: Boolean(config.apiKey),
  }
}

function authHeader(config: LlmConfig): Record<string, string> {
  return config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}
}

export async function listModels(config: LlmConfig): Promise<string[]> {
  const signal = AbortSignal.timeout(15_000)

  if (config.provider === 'gemini') {
    const res = await fetch(`${GEMINI_BASE}/models?key=${encodeURIComponent(config.apiKey ?? '')}`, {
      signal,
    })
    if (!res.ok) throw new LlmError('models_failed', `Gemini /models returned ${res.status}`)
    const data = (await res.json()) as { models?: { name?: string }[] }
    return (data.models ?? [])
      .map((model) => (model.name ?? '').replace(/^models\//, ''))
      .filter(Boolean)
  }

  const res = await fetch(`${config.baseUrl}/models`, { headers: authHeader(config), signal })
  if (!res.ok) throw new LlmError('models_failed', `${config.baseUrl}/models returned ${res.status}`)
  const data = (await res.json()) as { data?: { id?: string }[] }
  return (data.data ?? []).map((model) => model.id ?? '').filter(Boolean)
}

/** Accepts a bare object, a fenced block, or prose wrapping the object. */
function parseJsonLoose(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const candidate = (fenced ? fenced[1] : text).trim()

  try {
    return JSON.parse(candidate)
  } catch {
    const start = candidate.indexOf('{')
    const end = candidate.lastIndexOf('}')
    if (start === -1 || end <= start) {
      throw new LlmError(
        'invalid_json',
        `The model returned no JSON object (starts with: ${candidate.slice(0, 120) || 'nothing'})`,
      )
    }
    try {
      return JSON.parse(candidate.slice(start, end + 1))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new LlmError('invalid_json', `The model returned malformed JSON: ${message}`)
    }
  }
}

async function request(url: string, init: RequestInit, label: string): Promise<Response> {
  try {
    return await fetch(url, init)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      throw new LlmError('timeout', `${label} did not answer before the deadline`, 504)
    }
    throw new LlmError('network', `${label} is unreachable: ${message}`)
  }
}

async function assertOk(res: Response, label: string): Promise<Response> {
  if (res.ok) return res

  const raw = await res.text().catch(() => '')
  let detail = raw.slice(0, 300)
  try {
    const parsed = JSON.parse(raw) as { error?: { message?: string } | string }
    if (typeof parsed.error === 'string') detail = parsed.error
    else if (parsed.error?.message) detail = parsed.error.message
  } catch {
    /* keep the raw snippet */
  }

  const authFailure = res.status === 401 || res.status === 403
  throw new LlmError(
    authFailure ? 'unauthorized' : 'upstream',
    `${label} returned ${res.status}: ${detail || 'no body'}`,
    authFailure ? 401 : 502,
  )
}

async function callGemini(
  config: LlmConfig,
  model: string,
  userMessage: string,
  systemPrompt: string,
  signal: AbortSignal,
  temperature: number,
): Promise<{ text: string; usage?: unknown }> {
  const url = `${GEMINI_BASE}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(config.apiKey ?? '')}`

  const res = await request(
    url,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal,
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: userMessage }] }],
        generationConfig: { responseMimeType: 'application/json', temperature },
      }),
    },
    'Gemini',
  )

  await assertOk(res, 'Gemini')

  const payload = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[]
    usageMetadata?: unknown
  }
  const text = (payload.candidates?.[0]?.content?.parts ?? [])
    .map((part) => part.text ?? '')
    .join('')

  return { text, usage: payload.usageMetadata }
}

/**
 * Anthropic models behind an OpenAI-compatible gateway (OpenRouter, OmniRoute)
 * honour an explicit cache breakpoint on the system block. Every other family
 * caches prefixes automatically, so sending the marker would only add noise.
 */
function systemMessage(systemPrompt: string, model: string): Record<string, unknown> {
  if (/anthropic|claude/i.test(model)) {
    return {
      role: 'system',
      content: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
    }
  }
  return { role: 'system', content: systemPrompt }
}

async function callOpenAi(
  config: LlmConfig,
  model: string,
  userMessage: string,
  systemPrompt: string,
  signal: AbortSignal,
  temperature: number,
  jsonSchema?: JsonSchemaSpec,
): Promise<{ text: string; usage?: unknown }> {
  const url = `${config.baseUrl}/chat/completions`
  const headers = { 'content-type': 'application/json', ...authHeader(config) }

  // Three-step ladder: a strict schema when we have one, then plain JSON mode,
  // then nothing. Gateways differ in what they accept, and a 400 here is a
  // configuration mismatch, not a model failure.
  const responseFormat = (mode: 'schema' | 'json' | 'none') => {
    if (mode === 'schema' && jsonSchema) {
      return {
        response_format: {
          type: 'json_schema',
          json_schema: { name: jsonSchema.name, strict: false, schema: jsonSchema.schema },
        },
      }
    }
    if (mode === 'json') return { response_format: { type: 'json_object' } }
    return {}
  }

  const payloadFor = (mode: 'schema' | 'json' | 'none') =>
    JSON.stringify({
      model,
      temperature,
      ...responseFormat(mode),
      messages: [systemMessage(systemPrompt, model), { role: 'user', content: userMessage }],
    })

  const send = (mode: 'schema' | 'json' | 'none') =>
    request(url, { method: 'POST', headers, signal, body: payloadFor(mode) }, 'LLM')

  let res = await send(jsonSchema ? 'schema' : 'json')
  if (res.status === 400 || res.status === 422) res = await send('json')
  if (res.status === 400 || res.status === 422) res = await send('none')

  await assertOk(res, 'LLM')

  const payload = (await res.json()) as {
    choices?: { message?: { content?: string } }[]
    usage?: unknown
  }
  return { text: payload.choices?.[0]?.message?.content ?? '', usage: payload.usage }
}

export interface LlmUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
  /** How much of the prompt the provider served from its prefix cache. */
  cachedTokens?: number
}

export interface JsonSchemaSpec {
  name: string
  schema: Record<string, unknown>
}

export interface GenerateJsonOptions {
  config: LlmConfig
  /** The user turn, verbatim. Callers own the wording. */
  userMessage: string
  systemPrompt: string
  model?: string
  timeoutMs?: number
  temperature?: number
  /** When set, the provider is asked to constrain the answer to this shape. */
  jsonSchema?: JsonSchemaSpec
}

export interface GenerateJsonResult {
  data: unknown
  provider: LlmProvider
  model: string
  /** Absent when the gateway does not report usage. */
  usage?: LlmUsage
}

function normalizeUsage(raw: unknown): LlmUsage | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const record = raw as Record<string, unknown>
  const prompt = Number(record.prompt_tokens ?? record.promptTokenCount ?? 0)
  const completion = Number(record.completion_tokens ?? record.candidatesTokenCount ?? 0)
  const total = Number(record.total_tokens ?? record.totalTokenCount ?? prompt + completion)
  if (!Number.isFinite(prompt) || !Number.isFinite(completion)) return undefined

  const details = record.prompt_tokens_details as Record<string, unknown> | undefined
  const cached = Number(
    record.cached_tokens ?? details?.cached_tokens ?? record.cache_read_input_tokens ?? Number.NaN,
  )

  return {
    promptTokens: prompt,
    completionTokens: completion,
    totalTokens: total || prompt + completion,
    ...(Number.isFinite(cached) ? { cachedTokens: cached } : {}),
  }
}

export async function generateJson(options: GenerateJsonOptions): Promise<GenerateJsonResult> {
  const { config, userMessage, systemPrompt, jsonSchema } = options
  const model = options.model?.trim() || config.model
  const temperature = options.temperature ?? 0.8
  const signal = AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS)

  const call = () =>
    config.provider === 'gemini'
      ? callGemini(config, model, userMessage, systemPrompt, signal, temperature)
      : callOpenAi(config, model, userMessage, systemPrompt, signal, temperature, jsonSchema)

  // A reasoning model occasionally spends its whole budget on reasoning and
  // returns an empty message. One more attempt costs a second; surfacing
  // "empty completion" to the user costs a retry by hand.
  let reply = await call()
  if (!reply.text.trim()) reply = await call()
  if (!reply.text.trim()) {
    throw new LlmError('empty_completion', 'The model returned an empty completion')
  }

  return {
    data: parseJsonLoose(reply.text),
    provider: config.provider,
    model,
    usage: normalizeUsage(reply.usage),
  }
}
