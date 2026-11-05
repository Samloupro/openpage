import { useState } from 'react'
import type { BlockConfig } from '../types'
import { Menu, X } from 'lucide-react'

interface NavbarProps {
  logo: string
  links: string[]
  ctaText: string
}

function MobileMenu({ links, ctaText, open }: { links: string[]; ctaText: string; open: boolean }) {
  if (!open) return null

  return (
    <div className="border-t border-border-default bg-bg-1 px-4 py-3 space-y-1">
      {links.map((link, i) => (
        <span
          key={i}
          className="block px-4 py-3 rounded-lg text-[14px] text-text-1 hover:text-text-0 hover:bg-bg-2 transition-colors cursor-pointer"
        >
          {link}
        </span>
      ))}
      <div className="pt-2">
        <button className="w-full px-4 py-2 rounded-lg bg-green text-black text-[13px] font-semibold hover:bg-green-dim transition-colors">
          {ctaText}
        </button>
      </div>
    </div>
  )
}

function MenuButton({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-label="Toggle navigation"
      className="@2xl:hidden shrink-0 w-11 h-11 rounded-lg border border-border-default flex items-center justify-center text-text-2 hover:text-text-0 hover:bg-bg-3 transition-colors"
    >
      {open ? <X size={16} /> : <Menu size={16} />}
    </button>
  )
}

function NavbarDefault({ props }: { props: NavbarProps }) {
  const { logo, links = [], ctaText } = props
  const [open, setOpen] = useState(false)

  return (
    <div>
      <nav className="px-6 @md:px-10 py-4 flex items-center justify-between">
        {/* Logo */}
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-green/10 flex items-center justify-center">
            <div className="w-4 h-4 rounded-full bg-green" />
          </div>
          <span className="font-semibold text-[15px] text-text-0 tracking-tight">{logo}</span>
        </div>

        {/* Desktop nav links */}
        <div className="hidden @2xl:flex items-center gap-6">
          {links.map((link, i) => (
            <span
              key={i}
              className="text-[13px] text-text-2 hover:text-text-0 transition-colors cursor-pointer"
            >
              {link}
            </span>
          ))}
        </div>

        {/* CTA + mobile menu */}
        <div className="flex items-center gap-3">
          <button className="hidden @lg:inline-flex px-4 py-2 rounded-lg bg-green text-black text-[13px] font-semibold hover:bg-green-dim transition-colors">
            {ctaText}
          </button>
          <MenuButton open={open} onToggle={() => setOpen((value) => !value)} />
        </div>
      </nav>

      <MobileMenu links={links} ctaText={ctaText} open={open} />
    </div>
  )
}

function NavbarCentered({ props }: { props: NavbarProps }) {
  const { logo, links = [], ctaText } = props
  const [open, setOpen] = useState(false)
  const mid = Math.ceil(links.length / 2)
  const leftLinks = links.slice(0, mid)
  const rightLinks = links.slice(mid)

  return (
    <div>
      <nav className="px-6 @md:px-10 py-4 flex items-center justify-between">
        {/* Left links */}
        <div className="hidden @2xl:flex items-center gap-6 flex-1">
          {leftLinks.map((link, i) => (
            <span key={i} className="text-[13px] text-text-2 hover:text-text-0 transition-colors cursor-pointer">
              {link}
            </span>
          ))}
        </div>

        {/* Center logo */}
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-green/10 flex items-center justify-center">
            <div className="w-4 h-4 rounded-full bg-green" />
          </div>
          <span className="font-semibold text-[15px] text-text-0 tracking-tight">{logo}</span>
        </div>

        {/* Right links + CTA */}
        <div className="hidden @2xl:flex items-center gap-6 flex-1 justify-end">
          {rightLinks.map((link, i) => (
            <span key={i} className="text-[13px] text-text-2 hover:text-text-0 transition-colors cursor-pointer">
              {link}
            </span>
          ))}
          <button className="px-4 py-2 rounded-lg bg-green text-black text-[13px] font-semibold hover:bg-green-dim transition-colors ml-2">
            {ctaText}
          </button>
        </div>

        {/* Mobile menu */}
        <MenuButton open={open} onToggle={() => setOpen((value) => !value)} />
      </nav>

      <MobileMenu links={links} ctaText={ctaText} open={open} />
    </div>
  )
}

export function NavbarBlock({ block }: { block: BlockConfig }) {
  const props = block.props as unknown as NavbarProps

  switch (block.variant) {
    case 'centered':
      return <NavbarCentered props={props} />
    default:
      return <NavbarDefault props={props} />
  }
}
