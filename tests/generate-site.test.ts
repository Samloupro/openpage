import { describe, expect, it } from 'vitest'
import { validateSiteConfig } from '@/lib/generate-site'

/**
 * A model does not always respect the prop shapes the blocks declare. These
 * cases all used to reach the renderer and crash it with React error #31
 * ("objects are not valid as a React child").
 */
describe('validateSiteConfig prop coercion', () => {
  it('turns navbar links given as objects back into strings', () => {
    const config = validateSiteConfig({
      name: 'Test',
      blocks: [
        {
          id: 'navbar-1',
          type: 'navbar',
          variant: 'default',
          props: {
            logo: 'Dar Zitoun',
            links: [
              { label: 'Accueil', href: '/' },
              { label: 'Chambres', href: '/chambres' },
            ],
            ctaText: 'Réserver',
          },
        },
      ],
    })

    expect(config.blocks[0].props.links).toEqual(['Accueil', 'Chambres'])
  })

  it('falls back to the default list when nothing usable is left', () => {
    const config = validateSiteConfig({
      name: 'Test',
      blocks: [
        { id: 'footer-1', type: 'footer', variant: 'simple', props: { links: [{ href: '/x' }] } },
      ],
    })

    expect(config.blocks[0].props.links).toEqual(['Privacy', 'Terms'])
  })

  it('coerces a nested pricing feature list', () => {
    const config = validateSiteConfig({
      name: 'Test',
      blocks: [
        {
          id: 'pricing-1',
          type: 'pricing',
          variant: 'simple',
          props: {
            title: 'Tarifs',
            tiers: [
              { name: 'Essentiel', price: '0', features: [{ label: 'Un site' }, 'Export'], cta: 'Commencer' },
            ],
          },
        },
      ],
    })

    const tiers = config.blocks[0].props.tiers as { features: string[] }[]
    expect(tiers[0].features).toEqual(['Un site', 'Export'])
  })

  it('coerces an object where a string is expected', () => {
    const config = validateSiteConfig({
      name: 'Test',
      blocks: [
        {
          id: 'hero-1',
          type: 'hero',
          variant: 'centered',
          props: { headline: { text: 'Un titre' }, subheadline: 'Sous-titre' },
        },
      ],
    })

    expect(config.blocks[0].props.headline).toBe('Un titre')
  })

  it('keeps a valid config untouched', () => {
    const config = validateSiteConfig({
      name: 'Test',
      blocks: [
        {
          id: 'navbar-1',
          type: 'navbar',
          variant: 'default',
          props: { logo: 'X', links: ['A', 'B'], ctaText: 'Go' },
        },
      ],
    })

    expect(config.blocks[0].props.links).toEqual(['A', 'B'])
  })
})
