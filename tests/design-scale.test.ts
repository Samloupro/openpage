import { describe, it, expect } from 'vitest'
import { exportSiteToHTML } from '../src/lib/export-html'
import { designScale, fluidGutter, fluidSize, resolveTheme, themeToCSS } from '../src/lib/theme-presets'
import { validateSiteConfig } from '../src/lib/generate-site'
import type { SiteConfig } from '../src/blocks/types'

const hero = {
  id: 'hero-1',
  type: 'hero' as const,
  variant: 'centered',
  props: { headline: 'Hello', subheadline: 'World' },
}

function site(theme?: SiteConfig['theme']): SiteConfig {
  return { name: 'Scale', blocks: [hero], theme }
}

describe('fluidSize', () => {
  it('reaches the maximum at 1024px and keeps a 62% floor', () => {
    // 4.69vw at 1024px = 48px, and 29.8px is the floor.
    expect(fluidSize(48)).toBe('clamp(29.8px, 4.69vw, 48px)')
  })

  it('reproduces the Creder headline from one number', () => {
    // The live site measures 46.4px at 375 and 74.88px at 1440.
    expect(fluidSize(75)).toBe('clamp(46.5px, 7.32vw, 75px)')
  })

  it('never emits a bare number', () => {
    for (const max of [32, 48, 64, 96]) {
      expect(fluidSize(max)).toMatch(/^clamp\(\d+(\.\d)?px, \d+(\.\d+)?vw, \d+px\)$/)
    }
  })
})

describe('fluidGutter', () => {
  it('keeps a mobile floor and grows to the desktop value', () => {
    expect(fluidGutter(70)).toBe('clamp(1.5rem, 4.86vw, 70px)')
  })
})

describe('designScale', () => {
  it('reports nothing when the theme pulls no lever', () => {
    expect(designScale(resolveTheme())).toEqual({
      h1: false,
      h2: false,
      space: false,
      container: false,
      gutter: false,
    })
  })

  it('reports each lever independently', () => {
    expect(designScale(resolveTheme({ h1Size: 60 }))).toEqual({
      h1: true,
      h2: false,
      space: false,
      container: false,
      gutter: false,
    })
    expect(designScale(resolveTheme({ sectionSpacing: 100 }))).toEqual({
      h1: false,
      h2: false,
      space: true,
      container: false,
      gutter: false,
    })
    expect(designScale(resolveTheme({ gutter: 70 }))).toEqual({
      h1: false,
      h2: false,
      space: false,
      container: false,
      gutter: true,
    })
  })

  it('keeps the H2 override off when only the H1 is set', () => {
    // Clearing one field must not leave the other pointing at an undefined var.
    expect(designScale(resolveTheme({ h1Size: 60 })).h2).toBe(false)
  })
})

describe('themeToCSS', () => {
  it('emits no lever variable when the theme is untouched', () => {
    const vars = themeToCSS(resolveTheme())
    expect(vars['--op-h1']).toBeUndefined()
    expect(vars['--op-section-y']).toBeUndefined()
    expect(vars['--op-container']).toBeUndefined()
  })

  it('emits the derived clamp, not the raw number', () => {
    const vars = themeToCSS(resolveTheme({ h1Size: 75, gutter: 70 }))
    expect(vars['--op-h1']).toBe('clamp(46.5px, 7.32vw, 75px)')
    expect(vars['--op-gutter']).toBe('clamp(1.5rem, 4.86vw, 70px)')
  })
})

describe('exportSiteToHTML with design levers', () => {
  it('leaves the output byte-identical when no lever is set', () => {
    const plain = exportSiteToHTML(site())
    expect(plain).not.toContain('--op-h1')
    expect(plain).not.toContain('Design levers')
    expect(plain).not.toContain('!important')
  })

  it('overrides the heading size only when the theme sets it', () => {
    const html = exportSiteToHTML(site({ h1Size: 75 }))
    expect(html).toContain('--op-h1: clamp(46.5px, 7.32vw, 75px);')
    expect(html).toContain('h1 { font-size: var(--op-h1) !important; }')
    // h2 was not set, so it keeps its block class
    expect(html).not.toContain('h2 { font-size: var(--op-h2)')
  })

  it('flattens the section rhythm to one value', () => {
    const html = exportSiteToHTML(site({ sectionSpacing: 104 }))
    expect(html).toContain('--op-section-y: 104px;')
    expect(html).toContain('section { padding-top: var(--op-section-y) !important;')
  })

  it('widens only the two widest wrappers, never the narrow text columns', () => {
    const html = exportSiteToHTML(site({ containerWidth: 1420 }))
    expect(html).toContain('--op-container: 1420px;')
    expect(html).toContain('.max-w-5xl, .max-w-4xl { max-width: var(--op-container) !important; }')
    expect(html).not.toContain('.max-w-3xl { max-width')
  })

  it('caps the section itself, so a block with no wrapper cannot stretch', () => {
    const html = exportSiteToHTML(site({ containerWidth: 1420 }))
    expect(html).toContain('section { max-width: var(--op-container) !important;')
  })

  it('applies the gutter to the sections, the footer and the nav', () => {
    const html = exportSiteToHTML(site({ gutter: 70 }))
    expect(html).toContain('section, footer, nav { padding-left: var(--op-gutter) !important;')
  })
})

describe('validateSiteConfig bounds', () => {
  const raw = (theme: Record<string, unknown>) => ({
    name: 'Bounds',
    theme,
    blocks: [{ id: 'hero-1', type: 'hero', variant: 'centered', props: { headline: 'Hi' } }],
  })

  it('keeps a value inside its range', () => {
    const config = validateSiteConfig(raw({ h1Size: 75, sectionSpacing: 104, gutter: 70 }))
    expect(config.theme).toMatchObject({ h1Size: 75, sectionSpacing: 104, gutter: 70 })
  })

  it('drops a value outside its range instead of clamping it', () => {
    const config = validateSiteConfig(
      raw({ h1Size: 12, h2Size: 200, sectionSpacing: 400, containerWidth: 4000, gutter: 2 }),
    )
    expect(config.theme).toBeUndefined()
  })

  it('drops a value that is not a number', () => {
    const config = validateSiteConfig(raw({ h1Size: '75', containerWidth: null }))
    expect(config.theme).toBeUndefined()
  })

  it('rounds a fractional value', () => {
    const config = validateSiteConfig(raw({ h1Size: 74.6 }))
    expect(config.theme?.h1Size).toBe(75)
  })
})
