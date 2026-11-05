import { useCallback, useEffect, useState } from 'react'

/**
 * src/lib/llm-client.ts
 *
 * Owns: the browser's view of the server LLM configuration — status probe and
 * the user's preferred model — plus the React hook the UI reads it through.
 *
 * Open when: a screen needs to know whether AI generation is available.
 *
 * Never: store a provider API key. Keys live in the server environment; the only
 * key this app keeps in the browser is the optional client-side Gemini one.
 */

export interface LlmStatus {
  configured: boolean
  provider: 'gemini' | 'openai' | null
  model: string | null
  baseUrl: string | null
  hasKey: boolean
  reachable: boolean | null
  models: string[]
  error?: string
}

const EMPTY_STATUS: LlmStatus = {
  configured: false,
  provider: null,
  model: null,
  baseUrl: null,
  hasKey: false,
  reachable: null,
  models: [],
}

export const MODEL_STORAGE_KEY = 'openpage-llm-model'
export const GEMINI_KEY_STORAGE_KEY = 'openpage-gemini-key'

export function preferredModel(): string | undefined {
  try {
    return localStorage.getItem(MODEL_STORAGE_KEY) || undefined
  } catch {
    return undefined
  }
}

export function setPreferredModel(model: string): void {
  try {
    if (model) localStorage.setItem(MODEL_STORAGE_KEY, model)
    else localStorage.removeItem(MODEL_STORAGE_KEY)
  } catch {
    /* private mode: the preference simply does not persist */
  }
}

export function clientGeminiKey(): string | null {
  try {
    return localStorage.getItem(GEMINI_KEY_STORAGE_KEY)
  } catch {
    return null
  }
}

export async function fetchLlmStatus(): Promise<LlmStatus> {
  try {
    const res = await fetch('/api/llm', { headers: { accept: 'application/json' } })
    const contentType = res.headers.get('content-type') || ''
    if (!contentType.includes('application/json')) return EMPTY_STATUS

    const payload = (await res.json()) as Partial<LlmStatus>
    return {
      ...EMPTY_STATUS,
      ...payload,
      models: Array.isArray(payload.models) ? payload.models : [],
    }
  } catch {
    return EMPTY_STATUS
  }
}

export function useLlmStatus(): {
  status: LlmStatus | null
  loading: boolean
  refresh: () => void
} {
  const [status, setStatus] = useState<LlmStatus | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(() => {
    setLoading(true)
    fetchLlmStatus()
      .then((next) => setStatus(next))
      .catch(() => setStatus(EMPTY_STATUS))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  return { status, loading, refresh }
}
