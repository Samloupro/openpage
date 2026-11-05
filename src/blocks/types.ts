export type BlockType =
  | 'navbar'
  | 'hero'
  | 'features'
  | 'pricing'
  | 'cta'
  | 'footer'
  | 'testimonials'
  | 'stats'
  | 'faq'
  | 'team'
  | 'contact'
  | 'newsletter'
  | 'logocloud'
  | 'divider'
  | 'banner'
  | 'content'
  | 'image'
  | 'video'
  | 'gallery'

export type BlockVariant = string

/**
 * A section that does not sit on the page background. Only the colour is
 * stored: the text, card and border colours are derived from it at render
 * time, so changing the colour can never leave a stale palette behind.
 */
export interface SectionBackground {
  color: string
  tone?: 'auto' | 'light' | 'dark'
}

export interface BlockConfig {
  id: string
  type: BlockType
  variant: BlockVariant
  props: Record<string, unknown>
  background?: SectionBackground
}

export interface ThemeConfig {
  // Backgrounds
  bg0: string
  bg1: string
  bg2: string
  bg3: string
  bg4: string
  bg5: string
  // Text
  text0: string
  text1: string
  text2: string
  text3: string
  // Accent
  accent: string
  accentDim: string
  // Borders
  borderDefault: string
  borderSubtle: string
  borderHover: string
  // Fonts
  fontSans: string
  fontDisplay: string
  fontMono: string
  // Radius
  radius: number
  radiusLg: number
  /**
   * Design levers. Each one is optional and absent by default: when it is
   * missing the block's own hardcoded value wins, so an existing site keeps
   * its exact output until someone pulls the lever.
   *
   * Sizes are the desktop maximum in px; the renderer derives the fluid
   * clamp, so a model never has to write CSS.
   */
  h1Size?: number
  h2Size?: number
  sectionSpacing?: number
  containerWidth?: number
  gutter?: number
}

export interface PageConfig {
  id: string
  name: string
  path: string
  blocks: BlockConfig[]
}

export interface SiteConfig {
  name: string
  pages?: PageConfig[]
  blocks: BlockConfig[]
  theme?: Partial<ThemeConfig>
}
