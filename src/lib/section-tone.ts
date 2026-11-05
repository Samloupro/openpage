/**
 * src/lib/section-tone.ts
 *
 * Owns: the palette a section needs once it stops using the page background —
 * its text, card surfaces, borders and accent, all derived from one colour.
 *
 * Open when: a tinted section looks wrong, or someone questions the contrast of
 * a section that is not the page background.
 *
 * Never: persist a derived colour. Only `background.color` and an optional
 * `tone` are stored; everything else is recomputed on every render, so editing
 * the colour can never leave a stale text colour behind.
 */

import type { BlockConfig, SectionBackground } from '@/blocks/types'

export type SectionTone = 'auto' | 'light' | 'dark'

export interface SectionPalette {
  bg: string
  text0: string
  text1: string
  text2: string
  text3: string
  surface: string
  surfaceAlt: string
  surfaceDeep: string
  border: string
  borderSubtle: string
  borderHover: string
  accent?: string
}

type Rgb = [number, number, number]

const HEX = /^#([0-9a-f]{6})$/i

export function parseHex(value: unknown): Rgb | null {
  if (typeof value !== 'string') return null
  const match = HEX.exec(value.trim())
  if (!match) return null
  const int = Number.parseInt(match[1], 16)
  return [(int >> 16) & 0xff, (int >> 8) & 0xff, int & 0xff]
}

function toHex(rgb: Rgb): string {
  return `#${rgb
    .map((channel) => Math.max(0, Math.min(255, Math.round(channel))).toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()}`
}

function channelLuminance(channel: number): number {
  const value = channel / 255
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
}

export function relativeLuminance(rgb: Rgb): number {
  return (
    0.2126 * channelLuminance(rgb[0]) +
    0.7152 * channelLuminance(rgb[1]) +
    0.0722 * channelLuminance(rgb[2])
  )
}

export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  const high = Math.max(la, lb)
  const low = Math.min(la, lb)
  return (high + 0.05) / (low + 0.05)
}

function mix(from: Rgb, to: Rgb, amount: number): Rgb {
  return [
    from[0] + (to[0] - from[0]) * amount,
    from[1] + (to[1] - from[1]) * amount,
    from[2] + (to[2] - from[2]) * amount,
  ]
}

const WHITE: Rgb = [255, 255, 255]
const BLACK: Rgb = [0, 0, 0]

/**
 * The lightest touch of `target` that clears `ratio`. A fixed mix percentage
 * cannot work for every background: 55% toward black is comfortable on cream
 * and unreadable on a mid grey. Solving for the ratio keeps the promise.
 */
function mixToContrast(bg: Rgb, target: Rgb, ratio: number): Rgb {
  if (contrastRatio(bg, target) < ratio) return target

  let low = 0
  let high = 1
  for (let i = 0; i < 24; i += 1) {
    const mid = (low + high) / 2
    if (contrastRatio(bg, mix(bg, target, mid)) >= ratio) high = mid
    else low = mid
  }
  return mix(bg, target, high)
}

/**
 * A section is dark when its own background is dark, not when the page is.
 *
 * 0.179 is the luminance at which black and white text are equally readable —
 * the WCAG crossover. Using it instead of a round number means a mid grey gets
 * the direction that actually has more contrast, not the one that looks darker.
 */
export function resolveTone(bg: Rgb, tone: SectionTone = 'auto'): 'light' | 'dark' {
  if (tone === 'light' || tone === 'dark') return tone
  return relativeLuminance(bg) > 0.179 ? 'light' : 'dark'
}

/**
 * Text targets are WCAG AA with headroom: 4.5:1 is the floor for body copy, and
 * the muted steps sit just above it rather than on it.
 *
 * Every step is solved against the *deepest* surface of the section, not
 * against its background. A card is lighter than a dark section by a large
 * relative jump, so text that only clears AA on the background would fail on
 * the card it actually sits in.
 */
const TEXT_TARGETS = { text0: 13, text1: 9, text2: 6.5, text3: 4.6 } as const

const SURFACE_STEPS = { surface: 0.02, surfaceAlt: 0.035, surfaceDeep: 0.05 } as const

export function resolveSectionPalette(
  color: string,
  tone: SectionTone = 'auto',
  accent?: string,
): SectionPalette | null {
  const bg = parseHex(color)
  if (!bg) return null

  const mode = resolveTone(bg, tone)
  const towards = mode === 'dark' ? WHITE : BLACK

  const surface = mix(bg, towards, SURFACE_STEPS.surface)
  const surfaceAlt = mix(bg, towards, SURFACE_STEPS.surfaceAlt)
  const surfaceDeep = mix(bg, towards, SURFACE_STEPS.surfaceDeep)

  return {
    bg: toHex(bg),
    text0: toHex(mixToContrast(surfaceDeep, towards, TEXT_TARGETS.text0)),
    text1: toHex(mixToContrast(surfaceDeep, towards, TEXT_TARGETS.text1)),
    text2: toHex(mixToContrast(surfaceDeep, towards, TEXT_TARGETS.text2)),
    text3: toHex(mixToContrast(surfaceDeep, towards, TEXT_TARGETS.text3)),
    surface: toHex(surface),
    surfaceAlt: toHex(surfaceAlt),
    surfaceDeep: toHex(surfaceDeep),
    border: toHex(mix(bg, towards, mode === 'dark' ? 0.18 : 0.14)),
    borderSubtle: toHex(mix(bg, towards, mode === 'dark' ? 0.1 : 0.08)),
    borderHover: toHex(mix(bg, towards, mode === 'dark' ? 0.3 : 0.24)),
    // The accent is the brand colour and is never adjusted: a section that
    // silently repaints the brand is worse than a section that inherits it.
    accent: parseHex(accent) ? toHex(parseHex(accent)!) : undefined,
  }
}

export interface ToneLayer {
  /** One rule block per distinct palette, addressed by `data-op-tone`. */
  css: string
  /** block id → tone id, for the blocks that carry a background. */
  toneByBlock: Map<string, string>
}

/**
 * Two sections with the same colour share one rule block. A site with three
 * tints emits three blocks, not one per section.
 *
 * The `div` in the selector is load-bearing: it lifts specificity to (0,2,1),
 * which beats Tailwind's `.hover\:bg-bg-3:hover` at (0,2,0) without
 * `!important`.
 */
export function buildToneLayer(blocks: BlockConfig[], accent?: string): ToneLayer {
  const toneByBlock = new Map<string, string>()
  const byPalette = new Map<string, { id: string; palette: SectionPalette }>()

  for (const block of blocks) {
    const background = block.background
    if (!background) continue
    const palette = resolveSectionPalette(background.color, background.tone, accent)
    if (!palette) continue

    const key = JSON.stringify(palette)
    let entry = byPalette.get(key)
    if (!entry) {
      entry = { id: `t${byPalette.size + 1}`, palette }
      byPalette.set(key, entry)
    }
    toneByBlock.set(block.id, entry.id)
  }

  if (byPalette.size === 0) return { css: '', toneByBlock }

  const rules: string[] = []
  for (const { id, palette } of byPalette.values()) {
    const scope = `div[data-op-tone="${id}"]`
    rules.push(
      [
        `${scope} { background-color: ${palette.bg}; color: ${palette.text0}; }`,
        `${scope} .text-text-0 { color: ${palette.text0}; }`,
        `${scope} .text-text-1 { color: ${palette.text1}; }`,
        `${scope} .text-text-2 { color: ${palette.text2}; }`,
        `${scope} .text-text-3 { color: ${palette.text3}; }`,
        `${scope} .bg-bg-1 { background-color: ${palette.surface}; }`,
        `${scope} .bg-bg-2 { background-color: ${palette.surface}; }`,
        `${scope} .bg-bg-3 { background-color: ${palette.surfaceAlt}; }`,
        `${scope} .bg-bg-4 { background-color: ${palette.surfaceDeep}; }`,
        `${scope} .border-border-default { border-color: ${palette.border}; }`,
        `${scope} .border-border-subtle { border-color: ${palette.borderSubtle}; }`,
        `${scope} .border-border-hover { border-color: ${palette.borderHover}; }`,
        ...(palette.accent
          ? [
              `${scope} .text-green { color: ${palette.accent}; }`,
              `${scope} .bg-green { background-color: ${palette.accent}; }`,
              `${scope} .border-green { border-color: ${palette.accent}; }`,
            ]
          : []),
        `${scope} .hover\\:bg-bg-3:hover { background-color: ${palette.surfaceAlt}; }`,
        `${scope} .hover\\:bg-bg-4:hover { background-color: ${palette.surfaceDeep}; }`,
        `${scope} .hover\\:text-text-0:hover { color: ${palette.text0}; }`,
      ].join('\n    '),
    )
  }

  return { css: rules.join('\n    '), toneByBlock }
}

/** The same palette as CSS custom properties, for the React preview. */
export function paletteToCSSVars(palette: SectionPalette): Record<string, string> {
  return {
    '--color-bg-1': palette.surface,
    '--color-bg-2': palette.surface,
    '--color-bg-3': palette.surfaceAlt,
    '--color-bg-4': palette.surfaceDeep,
    '--color-text-0': palette.text0,
    '--color-text-1': palette.text1,
    '--color-text-2': palette.text2,
    '--color-text-3': palette.text3,
    '--color-border-default': palette.border,
    '--color-border-subtle': palette.borderSubtle,
    '--color-border-hover': palette.borderHover,
    ...(palette.accent ? { '--color-green': palette.accent } : {}),
  }
}

export function isSectionBackground(value: unknown): value is SectionBackground {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  if (!parseHex(record.color)) return false
  if (record.tone === undefined) return true
  return record.tone === 'auto' || record.tone === 'light' || record.tone === 'dark'
}
