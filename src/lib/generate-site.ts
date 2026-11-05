import type { SiteConfig, BlockConfig, SectionBackground, ThemeConfig } from '@/blocks/types'
import { blockMetadata } from '@/lib/block-metadata'
import { GENERATION_PROMPT } from '@/lib/generation-prompt'
import { getTemplateForPrompt } from '@/lib/templates'
import { clientGeminiKey, preferredModel } from '@/lib/llm-client'

const VALID_BLOCK_TYPES = new Set<string>(blockMetadata.map((b) => b.type))
const VARIANT_MAP = Object.fromEntries(blockMetadata.map((b) => [b.type, new Set(b.variants)]))
const DEFAULT_PROPS_MAP = Object.fromEntries(blockMetadata.map((b) => [b.type, b.defaultProps]))

const GEMINI_MODEL = 'gemini-3-flash-preview'

export interface GenerationResult {
  config: SiteConfig
  source: 'ai' | 'template'
  provider?: 'server' | 'gemini'
  model?: string
  warning?: string
}

/**
 * Three-step chain, in this order:
 *   1. POST /api/generate — the server owns the provider (OpenRouter, OmniRoute,
 *      Gemini, anything OpenAI-compatible) and the key.
 *   2. Client-side Gemini, only if a key was entered in Settings.
 *   3. Built-in template, instant and honest about it.
 */
export async function generateSiteConfig(prompt: string, signal?: AbortSignal): Promise<GenerationResult> {
  const notes: string[] = []

  try {
    const res = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ prompt, model: preferredModel() }),
      signal,
    })

    const contentType = res.headers.get('content-type') || ''
    if (contentType.includes('application/json')) {
      const payload = (await res.json()) as {
        config?: unknown
        provider?: string
        model?: string
        error?: string
        message?: string
      }

      if (res.ok && payload.config) {
        return {
          config: validateSiteConfig(payload.config, prompt),
          source: 'ai',
          provider: 'server',
          model: payload.model,
        }
      }

      // 501 means "no provider on this server" — a normal state, not a failure.
      if (res.status !== 501) {
        notes.push(payload.message || payload.error || `Server generation failed (${res.status})`)
      }
    }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') throw err
    notes.push(err instanceof Error ? err.message : String(err))
  }

  const apiKey = clientGeminiKey()
  if (apiKey) {
    try {
      const config = await callGeminiDirect(prompt, apiKey, signal)
      return { config, source: 'ai', provider: 'gemini', model: GEMINI_MODEL }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') throw err
      notes.push(err instanceof Error ? err.message : String(err))
    }
  }

  return {
    config: getTemplateForPrompt(prompt),
    source: 'template',
    ...(notes.length > 0 ? { warning: notes.join(' · ') } : {}),
  }
}

async function callGeminiDirect(prompt: string, apiKey: string, signal?: AbortSignal): Promise<SiteConfig> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: `Generate a website configuration for: ${prompt}` }] }],
        systemInstruction: { parts: [{ text: GENERATION_PROMPT }] },
        generationConfig: { responseMimeType: 'application/json', temperature: 0.8 },
      }),
    },
  )

  if (!res.ok) throw new Error(`Gemini API error: ${res.status}`)

  const data = await res.json()
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text
  if (!text) throw new Error('Empty Gemini response')

  return validateSiteConfig(JSON.parse(text), prompt)
}

function isValidHex(s: unknown): s is string {
  return typeof s === 'string' && /^#[0-9a-fA-F]{6}$/.test(s)
}

function validateTheme(raw: Record<string, unknown>): Partial<ThemeConfig> {
  const theme: Partial<ThemeConfig> = {}
  const colorKeys: (keyof ThemeConfig)[] = [
    'bg0', 'bg1', 'bg2', 'bg3', 'bg4', 'bg5',
    'text0', 'text1', 'text2', 'text3',
    'accent', 'accentDim',
    'borderDefault', 'borderSubtle', 'borderHover',
  ]
  const fontKeys: (keyof ThemeConfig)[] = ['fontSans', 'fontDisplay', 'fontMono']

  for (const key of colorKeys) {
    if (isValidHex(raw[key])) {
      (theme as Record<string, unknown>)[key] = raw[key]
    }
  }

  for (const key of fontKeys) {
    if (typeof raw[key] === 'string' && (raw[key] as string).length > 0) {
      (theme as Record<string, unknown>)[key] = raw[key]
    }
  }

  if (typeof raw.radius === 'number' && raw.radius >= 0 && raw.radius <= 24) {
    theme.radius = raw.radius
  }
  if (typeof raw.radiusLg === 'number' && raw.radiusLg >= 0 && raw.radiusLg <= 32) {
    theme.radiusLg = raw.radiusLg
  }

  // Design levers. A model that answers `h1Size: 12` or `containerWidth: 4000`
  // must not reach the renderer: the bounds are the range a real page can use.
  const sizeKeys: [keyof ThemeConfig, number, number][] = [
    ['h1Size', 32, 96],
    ['h2Size', 20, 64],
    ['sectionSpacing', 32, 160],
    ['containerWidth', 960, 1600],
    ['gutter', 16, 96],
  ]
  for (const [key, min, max] of sizeKeys) {
    const value = raw[key]
    if (typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max) {
      ;(theme as Record<string, unknown>)[key] = Math.round(value)
    }
  }

  return theme
}

function validateBlock(raw: Record<string, unknown>, index: number): BlockConfig | null {
  const type = raw.type as string
  if (!type || !VALID_BLOCK_TYPES.has(type)) return null

  const variants = VARIANT_MAP[type]
  let variant = raw.variant as string
  if (!variant || !variants?.has(variant)) {
    variant = blockMetadata.find((b) => b.type === type)?.variants[0] || 'default'
  }

  const defaultProps = DEFAULT_PROPS_MAP[type] || {}
  const props = typeof raw.props === 'object' && raw.props ? { ...defaultProps, ...raw.props } : defaultProps

  const block: BlockConfig = {
    id: typeof raw.id === 'string' && raw.id ? raw.id : `block-${type}-${index}-${Date.now()}`,
    type: type as BlockConfig['type'],
    variant,
    props: normalizeProps(type, props as Record<string, unknown>),
  }

  const background = normalizeBackground(raw.background)
  if (background) block.background = background

  return block
}

/**
 * A model that answers `background: "#0D212E"` or `background: { color: "navy" }`
 * must not reach the renderer. Only a six-digit hex survives, and the tone is
 * one of three words.
 */
export function normalizeBackground(value: unknown): SectionBackground | undefined {
  if (typeof value === 'string') {
    return /^#[0-9a-f]{6}$/i.test(value.trim()) ? { color: value.trim().toUpperCase() } : undefined
  }
  if (!value || typeof value !== 'object') return undefined

  const record = value as Record<string, unknown>
  const color = typeof record.color === 'string' ? record.color.trim() : ''
  if (!/^#[0-9a-f]{6}$/i.test(color)) return undefined

  const tone = record.tone
  const normalized: SectionBackground = { color: color.toUpperCase() }
  if (tone === 'light' || tone === 'dark' || tone === 'auto') normalized.tone = tone
  return normalized
}

/**
 * Models routinely answer `links: [{ label, href }]` where the block expects
 * `string[]`, or an object where it expects a string. Both crash the renderer
 * with React error #31, so every prop is coerced back to the shape its default
 * declares.
 */
function coerceStringList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null

  const out: string[] = []
  for (const entry of value) {
    if (typeof entry === 'string') {
      if (entry.trim()) out.push(entry)
      continue
    }
    if (entry && typeof entry === 'object') {
      const record = entry as Record<string, unknown>
      const label = record.label ?? record.text ?? record.name ?? record.title
      if (typeof label === 'string' && label.trim()) out.push(label)
    }
  }

  return out.length > 0 ? out : null
}

function coerceString(value: unknown): string | null {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    const parts = value.filter((entry): entry is string => typeof entry === 'string')
    return parts.length > 0 ? parts.join('\n\n') : null
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    const text = record.label ?? record.text ?? record.title ?? record.name ?? record.value
    return typeof text === 'string' ? text : null
  }
  return null
}

export function normalizeProps(type: string, props: Record<string, unknown>): Record<string, unknown> {
  const defaults = DEFAULT_PROPS_MAP[type] as Record<string, unknown> | undefined
  if (!defaults) return props

  const next = { ...props }

  for (const [key, fallback] of Object.entries(defaults)) {
    if (typeof fallback === 'string') {
      const coerced = coerceString(next[key])
      if (coerced !== null) next[key] = coerced
      else if (next[key] !== undefined) next[key] = fallback
      continue
    }

    if (!Array.isArray(fallback) || fallback.length === 0) continue
    if (!fallback.every((entry) => typeof entry === 'string')) continue
    next[key] = coerceStringList(next[key]) ?? fallback
  }

  // pricing.tiers[].features is a nested string list the defaults do not cover.
  if (type === 'pricing' && Array.isArray(next.tiers)) {
    next.tiers = (next.tiers as unknown[]).map((tier) => {
      if (!tier || typeof tier !== 'object') return tier
      const record = { ...(tier as Record<string, unknown>) }
      record.features = coerceStringList(record.features) ?? []
      return record
    })
  }

  return next
}

function validatePageBlocks(rawBlocks: unknown[]): BlockConfig[] {
  const blocks: BlockConfig[] = []
  for (let i = 0; i < rawBlocks.length; i++) {
    const block = validateBlock(rawBlocks[i] as Record<string, unknown>, i)
    if (block) blocks.push(block)
  }
  return blocks
}

export function validateSiteConfig(raw: unknown, prompt?: string): SiteConfig {
  if (!raw || typeof raw !== 'object') {
    return getTemplateForPrompt(prompt || '')
  }

  const obj = raw as Record<string, unknown>
  const name = typeof obj.name === 'string' ? obj.name : extractNameFromPrompt(prompt)

  // Try pages first
  let pages: { id: string; name: string; path: string; blocks: BlockConfig[] }[] | undefined
  if (Array.isArray(obj.pages) && obj.pages.length > 0) {
    pages = []
    for (const rawPage of obj.pages) {
      if (!rawPage || typeof rawPage !== 'object') continue
      const p = rawPage as Record<string, unknown>
      const pageBlocks = Array.isArray(p.blocks) ? validatePageBlocks(p.blocks) : []
      if (pageBlocks.length > 0) {
        pages.push({
          id: typeof p.id === 'string' ? p.id : `page-${Date.now()}-${pages.length}`,
          name: typeof p.name === 'string' ? p.name : `Page ${pages.length + 1}`,
          path: typeof p.path === 'string' ? p.path : `/${pages.length === 0 ? '' : `page-${pages.length}`}`,
          blocks: pageBlocks,
        })
      }
    }
    if (pages.length === 0) pages = undefined
  }

  // Fall back to top-level blocks
  let blocks: BlockConfig[] = []
  if (Array.isArray(obj.blocks)) {
    blocks = validatePageBlocks(obj.blocks)
  }

  // If we have pages but no top-level blocks, use first page's blocks for compat
  if (pages && pages.length > 0 && blocks.length === 0) {
    blocks = pages[0].blocks
  }

  if (!pages && blocks.length === 0) {
    return getTemplateForPrompt(prompt || '')
  }

  // If no pages but have blocks, wrap into single Home page
  if (!pages && blocks.length > 0) {
    pages = [{ id: 'page-home', name: 'Home', path: '/', blocks }]
  }

  let theme: Partial<ThemeConfig> | undefined
  if (obj.theme && typeof obj.theme === 'object') {
    theme = validateTheme(obj.theme as Record<string, unknown>)
    if (Object.keys(theme).length === 0) theme = undefined
  }

  return { name, pages, blocks, theme }
}

function extractNameFromPrompt(prompt?: string): string {
  if (!prompt) return 'My Website'
  const words = prompt.split(/\s+/).slice(0, 4).join(' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}
