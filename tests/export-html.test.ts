import { describe, it, expect } from 'vitest'
import { exportSiteToHTML } from '../src/lib/export-html'
import type { SiteConfig } from '../src/blocks/types'

const baseConfig: SiteConfig = {
  name: 'Test Site',
  blocks: [
    {
      id: 'hero-1',
      type: 'hero',
      variant: 'centered',
      props: {
        headline: 'Hello',
        subheadline: 'World',
        primaryCta: 'Start',
      },
    },
  ],
}

describe('exportSiteToHTML', () => {
  it('includes SEO metadata and language settings', () => {
    const html = exportSiteToHTML(baseConfig, {
      settings: {
        siteName: 'OpenPage',
        seoTitle: 'OpenPage Builder',
        seoDescription: 'Build <fast> websites safely',
        ogImageUrl: 'https://cdn.example.com/og.png',
        faviconUrl: 'https://cdn.example.com/favicon.ico',
        language: 'German',
      },
    })

    expect(html).toMatch(/<html lang="de">/)
    expect(html).toMatch(/<title>OpenPage Builder<\/title>/)
    expect(html).toMatch(/name="description" content="Build &lt;fast&gt; websites safely"/)
    expect(html).toMatch(/property="og:image" content="https:\/\/cdn\.example\.com\/og\.png"/)
    expect(html).toMatch(/rel="icon" href="https:\/\/cdn\.example\.com\/favicon\.ico"/)
  })

  it('injects analytics snippets when keys are provided', () => {
    const html = exportSiteToHTML(baseConfig, {
      settings: {
        gaId: 'G-ABC123XYZ',
        posthogKey: 'phc_test_key',
      },
    })

    expect(html).toMatch(/googletagmanager\.com\/gtag\/js\?id=G-ABC123XYZ/)
    expect(html).toMatch(/gtag\('config', "G-ABC123XYZ"\);/)
    expect(html).toMatch(/posthog\.init\("phc_test_key"/)
  })

  it('omits optional metadata when settings are absent', () => {
    const html = exportSiteToHTML(baseConfig)
    expect(html).not.toMatch(/name="description"/)
    expect(html).not.toMatch(/property="og:image"/)
    expect(html).not.toMatch(/googletagmanager/)
    expect(html).not.toMatch(/posthog\.init/)
  })
})

/**
 * The exporter used to drop every block type it had no renderer for, so a page
 * built from content blocks exported as an empty page with no warning.
 */
describe('exportSiteToHTML block coverage', () => {
  it('renders a content block, markdown included', () => {
    const html = exportSiteToHTML({
      name: 'Content',
      blocks: [
        {
          id: 'content-1',
          type: 'content',
          variant: 'prose',
          props: {
            body: '## Un titre\n\nUn paragraphe avec du **gras**.\n\n- premier point\n- second point',
          },
        },
      ],
    })

    expect(html).toContain('Un titre')
    expect(html).toContain('<strong class="font-semibold text-text-0">gras</strong>')
    expect(html).toContain('<li>premier point</li>')
    expect(html).not.toContain('Unknown block type')
  })

  it('escapes markup inside a content block', () => {
    const html = exportSiteToHTML({
      name: 'Content',
      blocks: [
        {
          id: 'content-1',
          type: 'content',
          variant: 'prose',
          props: { body: '<script>alert(1)</script>' },
        },
      ],
    })

    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('uses the footer description prop instead of the built-in copy', () => {
    const html = exportSiteToHTML({
      name: 'Footer',
      blocks: [
        {
          id: 'footer-1',
          type: 'footer',
          variant: 'multi-column',
          props: {
            logo: 'Creder',
            description: 'Conseil en crédit bancaire au Maroc.',
            copyright: '© 2026',
            columns: [{ title: 'Liens', links: ['Accueil'] }],
            links: [],
          },
        },
      ],
    })

    expect(html).toContain('Conseil en crédit bancaire au Maroc.')
    expect(html).not.toContain('Build beautiful websites with structured JSON config.')
  })
})
