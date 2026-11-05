/**
 * src/lib/edit-site.ts
 *
 * Owns: the outline sent to the server for an edit, the operation vocabulary
 * the model answers with, and the deterministic applier that turns operations
 * into a new SiteConfig.
 *
 * Open when: an edit does not land where you expected, or the op vocabulary
 * changes.
 *
 * Never: call the model with the whole config. The outline exists so an edit
 * costs a few hundred tokens instead of a full regeneration.
 */

import type { BlockConfig, PageConfig, SiteConfig, ThemeConfig } from '@/blocks/types'
import { blockMetadata } from '@/lib/block-metadata'
import { normalizeProps } from '@/lib/generate-site'
import { preferredModel } from '@/lib/llm-client'

const BLOCK_TYPES = new Set<string>(blockMetadata.map((block) => block.type))
const VARIANTS = Object.fromEntries(blockMetadata.map((block) => [block.type, new Set(block.variants)]))
const DEFAULT_PROPS = Object.fromEntries(blockMetadata.map((block) => [block.type, block.defaultProps]))

const TEXT_KEYS = ['headline', 'title', 'logo', 'body', 'text', 'subheadline', 'label', 'copyright']
const LIST_KEYS = ['items', 'members', 'tiers', 'images']
const PREVIEW_LENGTH = 56

export type EditOp =
  | { op: 'set'; page?: string; block: string; prop: string; value: unknown }
  | { op: 'setVariant'; page?: string; block: string; variant: string }
  | { op: 'setTheme'; prop: string; value: unknown }
  | { op: 'setName'; value: string }
  | { op: 'setPage'; page: string; prop: 'name' | 'path'; value: string }
  | {
      op: 'insert'
      page?: string
      index?: number
      type: string
      variant?: string
      props?: Record<string, unknown>
    }
  | { op: 'remove'; page?: string; block: string }
  | { op: 'move'; page?: string; from: number; to: number }

export interface EditOutline {
  name: string
  theme?: Record<string, unknown>
  pages: {
    id: string
    name: string
    path: string
    blocks: { id: string; type: string; variant: string; text?: string }[]
  }[]
}

export interface ApplyResult {
  config: SiteConfig
  applied: number
  skipped: string[]
}

export interface EditResult extends ApplyResult {
  summary: string
  model?: string
}

// ---------------------------------------------------------------------------
// Outline
// ---------------------------------------------------------------------------

function clip(value: string): string {
  const flat = value.replace(/\s+/g, ' ').trim()
  return flat.length > PREVIEW_LENGTH ? `${flat.slice(0, PREVIEW_LENGTH - 1)}…` : flat
}

/** A short reminder of what the block says, so the model can target it by meaning. */
function previewText(props: Record<string, unknown>): string | undefined {
  for (const key of TEXT_KEYS) {
    const value = props[key]
    if (typeof value === 'string' && value.trim()) return clip(value)
  }

  for (const key of LIST_KEYS) {
    const list = props[key]
    if (!Array.isArray(list) || list.length === 0) continue
    const first = list[0]
    if (first && typeof first === 'object') {
      const record = first as Record<string, unknown>
      const text = record.title ?? record.label ?? record.question ?? record.name ?? record.text
      if (typeof text === 'string' && text.trim()) return `${clip(text)} (+${list.length - 1})`
    }
    if (typeof first === 'string' && first.trim()) return `${clip(first)} (+${list.length - 1})`
  }

  return undefined
}

/**
 * Pages plus block ids, types and a text preview. No props, no theme ramp —
 * that is the 90% of the document an edit never needs.
 */
export function buildOutline(config: SiteConfig): EditOutline {
  const pages = config.pages?.length
    ? config.pages
    : [{ id: 'page-home', name: 'Home', path: '/', blocks: config.blocks }]

  const outline: EditOutline = {
    name: config.name,
    pages: pages.map((page) => ({
      id: page.id,
      name: page.name,
      path: page.path,
      blocks: page.blocks.map((block) => {
        const text = previewText(block.props)
        return { id: block.id, type: block.type, variant: block.variant, ...(text ? { text } : {}) }
      }),
    })),
  }

  if (config.theme && Object.keys(config.theme).length > 0) {
    outline.theme = { ...config.theme }
  }

  return outline
}

// ---------------------------------------------------------------------------
// Applier
// ---------------------------------------------------------------------------

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/**
 * A new accent without a matching dim leaves buttons hovering to the old
 * colour. The model is asked for both; when it forgets, derive one.
 */
function darkenHex(hex: string, amount = 0.18): string {
  const match = /^#([0-9a-f]{6})$/i.exec(hex)
  if (!match) return hex
  const value = Number.parseInt(match[1], 16)
  const channel = (shift: number) =>
    Math.max(0, Math.round(((value >> shift) & 0xff) * (1 - amount)))
      .toString(16)
      .padStart(2, '0')
  return `#${channel(16)}${channel(8)}${channel(0)}`
}

function pageList(config: SiteConfig): PageConfig[] {
  return config.pages?.length
    ? config.pages
    : [{ id: 'page-home', name: 'Home', path: '/', blocks: config.blocks }]
}

function resolvePage(pages: PageConfig[], pageId: string | undefined): PageConfig | undefined {
  if (!pageId) return pages[0]
  return pages.find((page) => page.id === pageId)
}

/**
 * Walks "items.2.title". Intermediate segments must exist; the last one may be
 * created, because adding a prop is a legitimate edit.
 */
function setPath(target: unknown, path: string, value: unknown): boolean {
  const segments = path.split('.').filter(Boolean)
  if (segments.length === 0) return false

  let cursor: unknown = target
  for (let i = 0; i < segments.length - 1; i += 1) {
    if (!cursor || typeof cursor !== 'object') return false
    cursor = (cursor as Record<string, unknown>)[segments[i]]
  }

  if (!cursor || typeof cursor !== 'object') return false
  const last = segments[segments.length - 1]

  if (Array.isArray(cursor)) {
    const index = Number(last)
    if (!Number.isInteger(index) || index < 0 || index >= cursor.length) return false
    cursor[index] = value
    return true
  }

  ;(cursor as Record<string, unknown>)[last] = value
  return true
}

function makeBlock(op: Extract<EditOp, { op: 'insert' }>, position: number): BlockConfig | null {
  if (!BLOCK_TYPES.has(op.type)) return null

  const variants = VARIANTS[op.type]
  const variant = op.variant && variants?.has(op.variant) ? op.variant : blockMetadata.find((b) => b.type === op.type)?.variants[0] || 'default'

  const props = { ...(DEFAULT_PROPS[op.type] ?? {}), ...(op.props ?? {}) }

  return {
    id: `block-${op.type}-${position}-${Date.now().toString(36)}`,
    type: op.type as BlockConfig['type'],
    variant,
    props: normalizeProps(op.type, props),
  }
}

/**
 * Pure. Every op is checked against the current document; an op that cannot be
 * applied is skipped and reported rather than throwing, so a partly-correct
 * answer still moves the site forward.
 */
export function applyEditOps(config: SiteConfig, ops: unknown[]): ApplyResult {
  const next = clone(config)
  let pages = pageList(next)
  const skipped: string[] = []
  let applied = 0
  let accentTouched = false
  let accentDimTouched = false

  for (const raw of ops) {
    if (!raw || typeof raw !== 'object') {
      skipped.push('not an object')
      continue
    }
    const op = raw as Record<string, unknown>
    const kind = op.op

    if (kind === 'set') {
      const page = resolvePage(pages, op.page as string | undefined)
      const block = page?.blocks.find((b) => b.id === op.block)
      if (!page || !block || typeof op.prop !== 'string') {
        skipped.push(`set: no block ${String(op.block)}`)
        continue
      }
      if (!setPath(block.props, op.prop, op.value)) {
        skipped.push(`set: bad path ${op.prop}`)
        continue
      }
      block.props = normalizeProps(block.type, block.props)
      applied += 1
      continue
    }

    if (kind === 'setVariant') {
      const page = resolvePage(pages, op.page as string | undefined)
      const block = page?.blocks.find((b) => b.id === op.block)
      const variant = typeof op.variant === 'string' ? op.variant : ''
      if (!block || !VARIANTS[block.type]?.has(variant)) {
        skipped.push(`setVariant: unknown variant ${variant}`)
        continue
      }
      block.variant = variant
      applied += 1
      continue
    }

    if (kind === 'setTheme') {
      if (typeof op.prop !== 'string') {
        skipped.push('setTheme: no prop')
        continue
      }
      next.theme = { ...(next.theme ?? {}), [op.prop]: op.value } as Partial<ThemeConfig>
      if (op.prop === 'accent') accentTouched = true
      if (op.prop === 'accentDim') accentDimTouched = true
      applied += 1
      continue
    }

    if (kind === 'setName') {
      if (typeof op.value !== 'string' || !op.value.trim()) {
        skipped.push('setName: empty value')
        continue
      }
      next.name = op.value
      applied += 1
      continue
    }

    if (kind === 'setPage') {
      const page = resolvePage(pages, op.page as string | undefined)
      const prop = op.prop
      if (!page || (prop !== 'name' && prop !== 'path') || typeof op.value !== 'string') {
        skipped.push('setPage: invalid')
        continue
      }
      page[prop] = op.value
      applied += 1
      continue
    }

    if (kind === 'insert') {
      const page = resolvePage(pages, op.page as string | undefined)
      if (!page) {
        skipped.push('insert: no page')
        continue
      }
      const requested = typeof op.index === 'number' ? op.index : page.blocks.length
      const index = Math.max(0, Math.min(page.blocks.length, requested))
      const block = makeBlock(op as Extract<EditOp, { op: 'insert' }>, index)
      if (!block) {
        skipped.push(`insert: unknown type ${String(op.type)}`)
        continue
      }
      page.blocks.splice(index, 0, block)
      applied += 1
      continue
    }

    if (kind === 'remove') {
      const page = resolvePage(pages, op.page as string | undefined)
      if (!page) {
        skipped.push('remove: no page')
        continue
      }
      const before = page.blocks.length
      page.blocks = page.blocks.filter((b) => b.id !== op.block)
      if (page.blocks.length === before) {
        skipped.push(`remove: no block ${String(op.block)}`)
        continue
      }
      applied += 1
      continue
    }

    if (kind === 'move') {
      const page = resolvePage(pages, op.page as string | undefined)
      const from = Number(op.from)
      const to = Number(op.to)
      if (!page || !Number.isInteger(from) || !Number.isInteger(to)) {
        skipped.push('move: invalid indices')
        continue
      }
      if (from < 0 || from >= page.blocks.length) {
        skipped.push(`move: from ${from} out of range`)
        continue
      }
      const [moved] = page.blocks.splice(from, 1)
      page.blocks.splice(Math.max(0, Math.min(page.blocks.length, to)), 0, moved)
      applied += 1
      continue
    }

    skipped.push(`unknown op ${String(kind)}`)
  }

  // The top-level blocks array mirrors the first page; several screens read it.
  pages = pages.map((page) => ({ ...page, blocks: page.blocks }))
  next.pages = pages
  next.blocks = pages[0]?.blocks ?? []

  if (accentTouched && !accentDimTouched && typeof next.theme?.accent === 'string') {
    next.theme = { ...next.theme, accentDim: darkenHex(next.theme.accent) }
  }

  return { config: next, applied, skipped }
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

/**
 * One request, one round trip. The server owns the provider; the browser only
 * sends the outline and the instruction.
 */
export async function editSiteConfig(
  config: SiteConfig,
  instruction: string,
  signal?: AbortSignal,
): Promise<EditResult> {
  const res = await fetch('/api/edit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      outline: buildOutline(config),
      instruction,
      model: preferredModel(),
    }),
    signal,
  })

  const contentType = res.headers.get('content-type') || ''
  if (!contentType.includes('application/json')) {
    throw new Error('The server did not answer with JSON. Is the API middleware running?')
  }

  const payload = (await res.json()) as {
    ops?: unknown[]
    summary?: string
    model?: string
    error?: string
    message?: string
  }

  if (res.status === 501) {
    throw new Error('No AI provider is configured on the server. See Settings.')
  }
  if (!res.ok) {
    throw new Error(payload.message || payload.error || `Edit failed (${res.status})`)
  }
  if (!Array.isArray(payload.ops)) {
    throw new Error('The model did not return an operation list.')
  }

  const result = applyEditOps(config, payload.ops)
  if (result.applied === 0 && payload.ops.length > 0) {
    throw new Error(`None of the ${payload.ops.length} proposed changes could be applied.`)
  }

  return {
    ...result,
    summary: payload.summary ?? '',
    model: payload.model,
  }
}
