import { describe, expect, it } from 'vitest'
import type { SiteConfig } from '@/blocks/types'
import { applyEditOps, buildOutline, pickFocusPages } from '@/lib/edit-site'

/**
 * The applier is the only thing standing between a model's answer and the live
 * site. Every case here is a way an op can be wrong: stale id, bad path, out of
 * range index. A wrong op must be skipped, never applied halfway.
 */

function site(): SiteConfig {
  const home = [
    { id: 'block-nav', type: 'navbar' as const, variant: 'default', props: { logo: 'Dar Zitoun', links: ['Accueil', 'Chambres'] } },
    {
      id: 'block-hero',
      type: 'hero' as const,
      variant: 'centered',
      props: { headline: 'Un riad au cœur de la médina', subheadline: 'Sept chambres, un patio.' },
    },
    {
      id: 'block-features',
      type: 'features' as const,
      variant: 'grid',
      props: {
        title: 'Nos services',
        items: [
          { icon: 'Star', title: 'Hammam', description: 'Sur demande' },
          { icon: 'Zap', title: 'Petit-déjeuner', description: 'Inclus' },
        ],
      },
    },
    { id: 'block-footer', type: 'footer' as const, variant: 'simple', props: { logo: 'Dar Zitoun', links: ['Contact'] } },
  ]

  return {
    name: 'Dar Zitoun',
    pages: [{ id: 'page-home', name: 'Accueil', path: '/', blocks: home }],
    blocks: home,
    theme: { accent: '#B4552D' },
  }
}

describe('applyEditOps', () => {
  it('replaces one prop and leaves everything else byte-identical', () => {
    const before = site()
    const { config, applied, skipped } = applyEditOps(before, [
      { op: 'set', page: 'page-home', block: 'block-hero', prop: 'headline', value: 'Un riad de charme' },
    ])

    expect(applied).toBe(1)
    expect(skipped).toEqual([])
    expect(config.pages![0].blocks[1].props.headline).toBe('Un riad de charme')
    expect(config.pages![0].blocks[1].props.subheadline).toBe('Sept chambres, un patio.')
    // the input is untouched
    expect(before.pages![0].blocks[1].props.headline).toBe('Un riad au cœur de la médina')
  })

  it('reaches into a list with a dotted path', () => {
    const { config, applied } = applyEditOps(site(), [
      { op: 'set', page: 'page-home', block: 'block-features', prop: 'items.1.title', value: 'Petit-déjeuner marocain' },
    ])

    expect(applied).toBe(1)
    const items = config.pages![0].blocks[2].props.items as { title: string }[]
    expect(items[1].title).toBe('Petit-déjeuner marocain')
    expect(items[0].title).toBe('Hammam')
  })

  it('skips a dotted path whose index is out of range', () => {
    const { applied, skipped } = applyEditOps(site(), [
      { op: 'set', page: 'page-home', block: 'block-features', prop: 'items.9.title', value: 'x' },
    ])

    expect(applied).toBe(0)
    expect(skipped[0]).toContain('bad path')
  })

  it('skips an op that targets a block that no longer exists', () => {
    const { applied, skipped } = applyEditOps(site(), [
      { op: 'set', page: 'page-home', block: 'block-gone', prop: 'headline', value: 'x' },
    ])

    expect(applied).toBe(0)
    expect(skipped[0]).toContain('no block block-gone')
  })

  it('applies the good ops and reports the bad one', () => {
    const { config, applied, skipped } = applyEditOps(site(), [
      { op: 'set', page: 'page-home', block: 'block-hero', prop: 'headline', value: 'Nouveau titre' },
      { op: 'set', page: 'page-home', block: 'block-ghost', prop: 'headline', value: 'x' },
      { op: 'setTheme', prop: 'accent', value: '#1F5F4B' },
    ])

    expect(applied).toBe(2)
    expect(skipped).toHaveLength(1)
    expect(config.pages![0].blocks[1].props.headline).toBe('Nouveau titre')
    expect(config.theme?.accent).toBe('#1F5F4B')
  })

  it('inserts a block at the requested index with the type defaults', () => {
    const { config, applied } = applyEditOps(site(), [
      { op: 'insert', page: 'page-home', index: 3, type: 'cta', variant: 'simple', props: { headline: 'Réservez' } },
    ])

    expect(applied).toBe(1)
    const blocks = config.pages![0].blocks
    expect(blocks).toHaveLength(5)
    expect(blocks[3].type).toBe('cta')
    expect(blocks[3].props.headline).toBe('Réservez')
    // untouched default props are filled in, so the renderer never sees undefined
    expect(typeof blocks[3].props.buttonText).toBe('string')
    expect(blocks[4].id).toBe('block-footer')
  })

  it('refuses to insert an unknown block type', () => {
    const { applied, skipped } = applyEditOps(site(), [
      { op: 'insert', page: 'page-home', index: 0, type: 'carousel-3d' },
    ])

    expect(applied).toBe(0)
    expect(skipped[0]).toContain('unknown type')
  })

  it('moves a block and keeps the array length', () => {
    const { config, applied } = applyEditOps(site(), [
      { op: 'move', page: 'page-home', from: 0, to: 2 },
    ])

    expect(applied).toBe(1)
    const ids = config.pages![0].blocks.map((block) => block.id)
    expect(ids).toEqual(['block-hero', 'block-features', 'block-nav', 'block-footer'])
  })

  it('keeps the top-level blocks array in sync with the first page', () => {
    const { config } = applyEditOps(site(), [
      { op: 'remove', page: 'page-home', block: 'block-nav' },
    ])

    expect(config.blocks.map((block) => block.id)).toEqual(
      config.pages![0].blocks.map((block) => block.id),
    )
    expect(config.blocks).toHaveLength(3)
  })

  it('derives accentDim when only the accent changes', () => {
    const { config } = applyEditOps(site(), [
      { op: 'setTheme', prop: 'accent', value: '#2F5D3A' },
    ])

    expect(config.theme?.accent).toBe('#2F5D3A')
    expect(config.theme?.accentDim).toBeDefined()
    expect(config.theme?.accentDim).not.toBe('#2F5D3A')
  })

  it('keeps an explicit accentDim', () => {
    const { config } = applyEditOps(site(), [
      { op: 'setTheme', prop: 'accent', value: '#2F5D3A' },
      { op: 'setTheme', prop: 'accentDim', value: '#1A3320' },
    ])

    expect(config.theme?.accentDim).toBe('#1A3320')
  })

  it('normalises props a model sends in the wrong shape', () => {
    const { config } = applyEditOps(site(), [
      {
        op: 'set',
        page: 'page-home',
        block: 'block-nav',
        prop: 'links',
        value: [{ label: 'Accueil' }, { label: 'Contact' }],
      },
    ])

    expect(config.pages![0].blocks[0].props.links).toEqual(['Accueil', 'Contact'])
  })
})

describe('buildOutline', () => {
  it('carries ids, types and a text preview, but not the props', () => {
    const outline = buildOutline(site())

    expect(outline.pages[0].blocks).toHaveLength(4)
    expect(outline.pages[0].blocks[1]).toEqual({
      id: 'block-hero',
      type: 'hero',
      variant: 'centered',
      text: 'Un riad au cœur de la médina',
    })
    expect(JSON.stringify(outline)).not.toContain('Sept chambres')
  })

  it('stays far smaller than the document it describes', () => {
    const config = site()
    const outline = buildOutline(config)

    expect(JSON.stringify(outline).length).toBeLessThan(JSON.stringify(config).length)
  })
})

function multiPageSite(): SiteConfig {
  const home = site().pages![0].blocks
  const chambres = [
    { id: 'block-nav-c', type: 'navbar' as const, variant: 'default', props: { logo: 'Dar Zitoun' } },
    { id: 'block-hero-c', type: 'hero' as const, variant: 'split', props: { headline: 'Sept chambres' } },
    { id: 'block-footer-c', type: 'footer' as const, variant: 'simple', props: { logo: 'Dar Zitoun' } },
  ]
  const riad = [
    { id: 'block-hero-r', type: 'hero' as const, variant: 'minimal', props: { headline: 'Le riad' } },
    { id: 'block-footer-r', type: 'footer' as const, variant: 'simple', props: { logo: 'Dar Zitoun' } },
  ]

  return {
    name: 'Dar Zitoun',
    pages: [
      { id: 'page-home', name: 'Accueil', path: '/', blocks: home },
      { id: 'page-chambres', name: 'Chambres & Suites', path: '/chambres', blocks: chambres },
      { id: 'page-riad', name: 'Le Riad', path: '/le-riad', blocks: riad },
    ],
    blocks: home,
    theme: { accent: '#B4552D' },
  }
}

describe('pickFocusPages', () => {
  const pages = multiPageSite().pages!

  it('follows the page the instruction names', () => {
    expect([...pickFocusPages(pages, { instruction: 'Change le titre de la page Chambres' })]).toEqual([
      'page-chambres',
    ])
  })

  it('matches without accents or case', () => {
    expect([...pickFocusPages(pages, { instruction: 'CHAMBRES & SUITES' })]).toEqual(['page-chambres'])
  })

  it('matches a meaningful word of a multi-word page name', () => {
    expect([...pickFocusPages(pages, { instruction: 'sur la page riad' })]).toEqual(['page-riad'])
  })

  it('matches the path', () => {
    expect([...pickFocusPages(pages, { instruction: 'aller voir /le-riad' })]).toEqual(['page-riad'])
  })

  it('falls back to the active page when nothing is named', () => {
    expect([...pickFocusPages(pages, { instruction: 'Ajoute une FAQ avant le footer', activePageId: 'page-riad' })]).toEqual([
      'page-riad',
    ])
  })

  it('sends everything when it has no instruction and no active page', () => {
    expect(pickFocusPages(pages, {}).size).toBe(3)
  })

  it('ignores an active page id that no longer exists', () => {
    expect(pickFocusPages(pages, { activePageId: 'page-gone' }).size).toBe(3)
  })
})

describe('focused outline', () => {
  it('sends the blocks of one page and only the names of the others', () => {
    const outline = buildOutline(multiPageSite(), {
      instruction: 'Change le titre du hero de la page Chambres',
    })

    const [home, chambres, riad] = outline.pages
    expect(home.blocks).toEqual([])
    expect(riad.blocks).toEqual([])
    expect(chambres.blocks).toHaveLength(3)
    // the other pages stay identifiable, so a rename is still possible
    expect(riad).toMatchObject({ id: 'page-riad', name: 'Le Riad', path: '/le-riad' })
  })

  it('costs a fraction of the full outline', () => {
    const config = multiPageSite()
    const full = buildOutline(config)
    const focused = buildOutline(config, { activePageId: 'page-home' })

    expect(JSON.stringify(focused).length).toBeLessThan(JSON.stringify(full).length)
  })
})

describe('setBackground', () => {
  it('gives one section its own colour and leaves the rest alone', () => {
    const { config, applied } = applyEditOps(site(), [
      { op: 'setBackground', page: 'page-home', block: 'block-hero', color: '#0d212e' },
    ])

    expect(applied).toBe(1)
    expect(config.pages![0].blocks[1].background).toEqual({ color: '#0D212E' })
    expect(config.pages![0].blocks[0].background).toBeUndefined()
  })

  it('keeps an explicit tone and drops an unknown one', () => {
    const withTone = applyEditOps(site(), [
      { op: 'setBackground', page: 'page-home', block: 'block-hero', color: '#0D212E', tone: 'light' },
    ])
    expect(withTone.config.pages![0].blocks[1].background).toEqual({ color: '#0D212E', tone: 'light' })

    const badTone = applyEditOps(site(), [
      { op: 'setBackground', page: 'page-home', block: 'block-hero', color: '#0D212E', tone: 'sepia' },
    ])
    expect(badTone.config.pages![0].blocks[1].background).toEqual({ color: '#0D212E' })
  })

  it('clears the background with a null colour', () => {
    const tinted = applyEditOps(site(), [
      { op: 'setBackground', page: 'page-home', block: 'block-hero', color: '#0D212E' },
    ]).config

    const cleared = applyEditOps(tinted, [
      { op: 'setBackground', page: 'page-home', block: 'block-hero', color: null },
    ])

    expect(cleared.applied).toBe(1)
    expect(cleared.config.pages![0].blocks[1].background).toBeUndefined()
  })

  it('skips a colour that is not a six-digit hex', () => {
    const { applied, skipped } = applyEditOps(site(), [
      { op: 'setBackground', page: 'page-home', block: 'block-hero', color: 'navy' },
    ])

    expect(applied).toBe(0)
    expect(skipped[0]).toContain('bad colour')
  })

  it('skips a block id that is not in the outline', () => {
    const { applied, skipped } = applyEditOps(site(), [
      { op: 'setBackground', page: 'page-home', block: 'block-gone', color: '#0D212E' },
    ])

    expect(applied).toBe(0)
    expect(skipped[0]).toContain('no block')
  })

  it('carries the current colour in the outline, and nothing when there is none', () => {
    const tinted = applyEditOps(site(), [
      { op: 'setBackground', page: 'page-home', block: 'block-hero', color: '#0D212E' },
    ]).config

    const outline = buildOutline(tinted)
    const blocks = outline.pages[0].blocks

    expect(blocks.find((b) => b.id === 'block-hero')?.background).toBe('#0D212E')
    expect(blocks.find((b) => b.id === 'block-nav')?.background).toBeUndefined()
  })

  it('accepts a background on an inserted block', () => {
    const { config } = applyEditOps(site(), [
      {
        op: 'insert',
        page: 'page-home',
        index: 1,
        type: 'cta',
        props: { headline: 'R�servez' },
        background: { color: '#0D212E' },
      },
    ])

    expect(config.pages![0].blocks[1].background).toEqual({ color: '#0D212E' })
  })
})
