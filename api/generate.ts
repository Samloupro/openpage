import type { VercelRequest, VercelResponse } from '@vercel/node'
import { GENERATION_PROMPT } from '../src/lib/generation-prompt'
import { LlmError, generateJson, listModels, publicStatus, readLlmConfig } from '../server/llm'

/**
 * Vercel entry point. Same contract as the Vite middleware in server/api.ts:
 * GET returns the provider status, POST turns a prompt into a SiteConfig.
 *
 * The provider is chosen by the environment only — a caller can pick the model
 * from the list the server advertises, never the endpoint or the key.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('cache-control', 'no-store')

  if (req.method === 'GET') {
    const config = readLlmConfig()
    const status = publicStatus(config)
    if (!config) return res.status(200).json({ ...status, reachable: null, models: [] })

    try {
      const models = await listModels(config)
      return res.status(200).json({ ...status, reachable: true, models })
    } catch (error) {
      return res.status(200).json({
        ...status,
        reachable: false,
        models: [],
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  if (req.method !== 'POST') {
    res.setHeader('allow', 'GET, POST')
    return res.status(405).json({ error: 'method_not_allowed', message: 'Use GET or POST.' })
  }

  const body = (req.body ?? {}) as { prompt?: unknown; model?: unknown }
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : ''
  if (!prompt) {
    return res.status(400).json({
      error: 'prompt_required',
      message: 'Body must contain a non-empty "prompt".',
    })
  }

  const config = readLlmConfig()
  if (!config) {
    return res.status(501).json({
      error: 'llm_not_configured',
      message:
        'No provider configured on the server. Set OPENPAGE_LLM_PROVIDER, OPENPAGE_LLM_BASE_URL, OPENPAGE_LLM_API_KEY and OPENPAGE_LLM_MODEL, or GEMINI_API_KEY.',
    })
  }

  try {
    const model = typeof body.model === 'string' && body.model.trim() ? body.model.trim() : undefined
    const result = await generateJson({
      config,
      prompt,
      systemPrompt: GENERATION_PROMPT,
      model,
      timeoutMs: 60_000,
    })
    return res.status(200).json({ config: result.data, provider: result.provider, model: result.model })
  } catch (error) {
    const failure =
      error instanceof LlmError
        ? error
        : new LlmError('internal', error instanceof Error ? error.message : String(error), 500)
    return res.status(failure.status).json({ error: failure.code, message: failure.message })
  }
}
