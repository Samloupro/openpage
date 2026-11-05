/**
 * server/api.ts
 *
 * Owns: the two HTTP endpoints the browser calls — GET /api/llm (provider
 * status, never the key) and POST /api/generate (prompt -> SiteConfig).
 *
 * Open when: wiring a new route onto the dev/preview server or changing the
 * request/response contract of the generation endpoint.
 *
 * Never: let a caller choose the provider, the base URL, or the key; those come
 * from the environment only.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { GENERATION_PROMPT } from '../src/lib/generation-prompt'
import { LlmError, generateJson, listModels, publicStatus, readLlmConfig } from './llm'

type Next = (err?: unknown) => void

const MAX_BODY_BYTES = 64 * 1024

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(payload))
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0

  for await (const chunk of req) {
    const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer)
    size += buffer.length
    if (size > MAX_BODY_BYTES) {
      throw new LlmError('payload_too_large', 'Request body is too large', 413)
    }
    chunks.push(buffer)
  }

  if (size === 0) return {}

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new LlmError('invalid_body', 'Request body is not valid JSON', 400)
  }
}

async function statusPayload(): Promise<Record<string, unknown>> {
  const config = readLlmConfig()
  const status = publicStatus(config)

  if (!config) return { ...status, reachable: null, models: [] }

  try {
    const models = await listModels(config)
    return { ...status, reachable: true, models }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ...status, reachable: false, models: [], error: message }
  }
}

/**
 * A model occasionally answers with a perfectly valid JSON object that has
 * nothing to do with the schema (a stray search payload, an error envelope).
 * Catching it here keeps the editor from rendering an empty site.
 */
function isSiteConfigShaped(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const config = value as Record<string, unknown>
  const hasName = typeof config.name === 'string' && config.name.trim().length > 0
  const hasBlocks = Array.isArray(config.blocks) && config.blocks.length > 0
  const hasPages = Array.isArray(config.pages) && config.pages.length > 0
  return hasName && (hasBlocks || hasPages)
}

const GENERATION_TIMEOUT_MS = 120_000

export function createOpenPageApi() {
  return async function openPageApi(
    req: IncomingMessage,
    res: ServerResponse,
    next: Next,
  ): Promise<void> {
    const path = (req.url ?? '').split('?')[0]
    if (path !== '/api/llm' && path !== '/api/generate') return next()

    try {
      if (path === '/api/llm') {
        if (req.method !== 'GET') {
          return sendJson(res, 405, { error: 'method_not_allowed', message: 'Use GET.' })
        }
        return sendJson(res, 200, await statusPayload())
      }

      if (req.method !== 'POST') {
        return sendJson(res, 405, { error: 'method_not_allowed', message: 'Use POST.' })
      }

      const body = (await readJsonBody(req)) as { prompt?: unknown; model?: unknown }
      const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : ''
      if (!prompt) {
        return sendJson(res, 400, {
          error: 'prompt_required',
          message: 'Body must contain a non-empty "prompt".',
        })
      }

      const config = readLlmConfig()
      if (!config) {
        return sendJson(res, 501, {
          error: 'llm_not_configured',
          message:
            'No provider configured on the server. Set OPENPAGE_LLM_PROVIDER, OPENPAGE_LLM_BASE_URL, OPENPAGE_LLM_API_KEY and OPENPAGE_LLM_MODEL, or GEMINI_API_KEY.',
        })
      }

      const model = typeof body.model === 'string' && body.model.trim() ? body.model.trim() : undefined

      const attempt = () =>
        generateJson({
          config,
          prompt,
          systemPrompt: GENERATION_PROMPT,
          model,
          timeoutMs: GENERATION_TIMEOUT_MS,
        })

      let result = await attempt()
      if (!isSiteConfigShaped(result.data)) {
        // One retry: a model that answered with an unrelated object usually
        // gets it right on the second try.
        result = await attempt()
      }

      if (!isSiteConfigShaped(result.data)) {
        return sendJson(res, 502, {
          error: 'invalid_config',
          message:
            'The model did not return a site configuration. Try again, or pick another model in Settings.',
        })
      }

      return sendJson(res, 200, {
        config: result.data,
        provider: result.provider,
        model: result.model,
      })
    } catch (error) {
      const failure =
        error instanceof LlmError
          ? error
          : new LlmError(
              'internal',
              error instanceof Error ? error.message : String(error),
              500,
            )
      return sendJson(res, failure.status, { error: failure.code, message: failure.message })
    }
  }
}
