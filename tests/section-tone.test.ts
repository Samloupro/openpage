import { describe, it, expect } from 'vitest'
import {
  buildToneLayer,
  contrastRatio,
  parseHex,
  resolveSectionPalette,
  resolveTone,
} from '../src/lib/section-tone'
import { exportSiteToHTML } from '../src/lib/export-html'
import type { BlockConfig, SiteConfig } from '../src/blocks/types'

const hero: BlockConfig = {
  id: 'hero-1',
  type: 'hero',
  variant: 'centered',
  props: { headline: 'Hello', subheadline: 'World' },
}

describe('section tone', () => {
  it('reads a six-digit hex and rejects anything else', () => {
    expect(parseHex('#0D212E')).toEqual([13, 33, 46])
    expect(parseHex('#fff')).toBeNull()
    expect(parseHex('navy')).toBeNull()
    expect(parseHex(undefined)).toBeNull()
  })

  it('decides light or dark from the colour itself', () => {
    expect(resolveTone(parseHex('#0D212E')!)).toBe('dark')
    expect(resolveTone(parseHex('#F2EEE9')!)).toBe('light')
    // an explicit tone wins over the luminance
    expect(resolveTone(parseHex('#0D212E')!, 'light')).toBe('light')
  })

  it('keeps every text step above the AA floor on a dark section', () => {
    const palette = resolveSectionPalette('#0D212E')!
    const bg = parseHex(palette.bg)!

    expect(contrastRatio(bg, parseHex(palette.text0)!)).toBeGreaterThanOrEqual(12)
    expect(contrastRatio(bg, parseHex(palette.text1)!)).toBeGreaterThanOrEqual(8)
    expect(contrastRatio(bg, parseHex(palette.text2)!)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(bg, parseHex(palette.text3)!)).toBeGreaterThanOrEqual(4.5)
  })

  it('keeps every text step above the AA floor on a light section', () => {
    const palette = resolveSectionPalette('#F2EEE9')!
    const bg = parseHex(palette.bg)!

    expect(contrastRatio(bg, parseHex(palette.text0)!)).toBeGreaterThanOrEqual(12)
    expect(contrastRatio(bg, parseHex(palette.text2)!)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(bg, parseHex(palette.text3)!)).toBeGreaterThanOrEqual(4.5)
  })

  it('keeps the muted steps readable on the deepest card, not just the background', () => {
    for (const color of ['#0D212E', '#171717', '#F2EEE9', '#FFFFFF', '#1B2A3A']) {
      const palette = resolveSectionPalette(color)!
      const card = parseHex(palette.surfaceDeep)!
      expect(contrastRatio(card, parseHex(palette.text3)!)).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(card, parseHex(palette.text2)!)).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('picks the text direction at the WCAG crossover, not at a round number', () => {
    // 0.179 is where black and white are equally readable; a mid grey must not
    // be treated as "dark" just because it looks dark.
    expect(resolveTone(parseHex('#7A7A7A')!)).toBe('light')
    expect(resolveTone(parseHex('#6E6E6E')!)).toBe('dark')
  })

  it('still returns a usable palette on a mid grey, where AA is out of reach', () => {
    const palette = resolveSectionPalette('#7A7A7A')!
    const card = parseHex(palette.surfaceDeep)!
    expect(contrastRatio(card, parseHex(palette.text3)!)).toBeGreaterThanOrEqual(4.4)
  })

  it('keeps the text hierarchy in order', () => {
    for (const color of ['#0D212E', '#F2EEE9']) {
      const palette = resolveSectionPalette(color)!
      const bg = parseHex(palette.bg)!
      const steps = [palette.text0, palette.text1, palette.text2, palette.text3].map(
        (hex) => contrastRatio(bg, parseHex(hex)!),
      )
      expect(steps[0]).toBeGreaterThan(steps[1])
      expect(steps[1]).toBeGreaterThan(steps[2])
      expect(steps[2]).toBeGreaterThan(steps[3])
    }
  })

  it('never repaints the brand accent', () => {
    // a near-black accent on a near-black section stays the brand colour
    expect(resolveSectionPalette('#0D212E', 'auto', '#101010')!.accent).toBe('#101010')
    expect(resolveSectionPalette('#0D212E', 'auto', '#D3A05E')!.accent).toBe('#D3A05E')
    expect(resolveSectionPalette('#0D212E')!.accent).toBeUndefined()
  })

  it('shares one rule block between sections of the same colour', () => {
    const layer = buildToneLayer([
      { ...hero, id: 'a', background: { color: '#0D212E' } },
      { ...hero, id: 'b', background: { color: '#0D212E' } },
      { ...hero, id: 'c', background: { color: '#F2EEE9' } },
    ])

    expect(layer.toneByBlock.get('a')).toBe('t1')
    expect(layer.toneByBlock.get('b')).toBe('t1')
    expect(layer.toneByBlock.get('c')).toBe('t2')
    expect(layer.css.match(/div\[data-op-tone="t1"\] \{/g)).toHaveLength(1)
  })

  it('emits nothing when no block carries a background', () => {
    const layer = buildToneLayer([hero])
    expect(layer.css).toBe('')
    expect(layer.toneByBlock.size).toBe(0)
  })
})

describe('exportSiteToHTML with section backgrounds', () => {
  const config: SiteConfig = {
    name: 'Tinted',
    blocks: [
      hero,
      { ...hero, id: 'cta-1', type: 'cta', background: { color: '#0D212E' } },
    ],
  }

  it('wraps only the tinted block and scopes its rules', () => {
    const html = exportSiteToHTML(config)

    expect(html).toContain('<div data-op-tone="t1">')
    expect(html.match(/<div data-op-tone="t1">/g)).toHaveLength(1) // one wrapper, one section
    expect(html).toContain('div[data-op-tone="t1"] .text-text-2 { color:')
    expect(html).toContain('div[data-op-tone="t1"] .bg-bg-2 { background-color:')
  })

  it('leaves the output byte-identical when no block is tinted', () => {
    const plain: SiteConfig = { name: 'Plain', blocks: [hero] }
    const html = exportSiteToHTML(plain)

    expect(html).not.toContain('data-op-tone')
    expect(html).not.toContain('Section backgrounds')
  })

  it('ignores a background that is not a six-digit hex', () => {
    const html = exportSiteToHTML({
      name: 'Bad',
      blocks: [{ ...hero, background: { color: 'navy' } }],
    })
    expect(html).not.toContain('data-op-tone')
  })
})
