import { useState, useMemo } from 'react'
import { ChevronDown } from 'lucide-react'
import { useConfigStore } from '@/store/configStore'
import type { ThemeConfig } from '@/blocks/types'
import { themePresets, resolveTheme, googleFontOptions } from '@/lib/theme-presets'

function ColorInput({ value, onInput, onChange }: { value: string; onInput: (v: string) => void; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-1.5">
      <input
        type="color"
        value={value}
        onInput={(e) => onInput((e.target as HTMLInputElement).value)}
        onChange={(e) => onChange(e.target.value)}
        className="w-6 h-6 rounded border border-border-default bg-bg-2 cursor-pointer p-0.5 shrink-0"
      />
      <input
        type="text"
        value={value}
        onChange={(e) => {
          const v = e.target.value
          if (/^#[0-9a-fA-F]{6}$/.test(v)) onChange(v)
        }}
        onBlur={(e) => {
          const v = e.target.value
          if (/^#[0-9a-fA-F]{6}$/.test(v)) onChange(v)
        }}
        className="w-[72px] px-1.5 py-1 rounded border border-border-default bg-bg-2 text-text-1 text-[10px] font-mono outline-none focus:border-green"
      />
    </div>
  )
}

function ColorSection({ title, colors, defaultOpen = false }: {
  title: string
  colors: { key: keyof ThemeConfig; label: string }[]
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  const theme = useConfigStore((s) => s.config.theme)
  const previewTheme = useConfigStore((s) => s.previewTheme)
  const updateTheme = useConfigStore((s) => s.updateTheme)
  const resolved = useMemo(() => resolveTheme(theme), [theme])

  return (
    <div className="border border-border-default rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-3 py-2 bg-bg-2 hover:bg-bg-3 transition-colors text-left"
      >
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold">{title}</span>
          <div className="flex gap-0.5">
            {colors.slice(0, 4).map((c) => (
              <div
                key={c.key}
                className="w-3 h-3 rounded-sm border border-border-subtle"
                style={{ backgroundColor: resolved[c.key] as string }}
              />
            ))}
          </div>
        </div>
        <ChevronDown size={12} className={`text-text-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="px-3 py-2.5 space-y-2.5 bg-bg-1">
          {colors.map((c) => (
            <div key={c.key} className="flex items-center justify-between">
              <span className="text-[10.5px] text-text-2">{c.label}</span>
              <ColorInput
                value={resolved[c.key] as string}
                onInput={(v) => previewTheme({ [c.key]: v })}
                onChange={(v) => updateTheme({ [c.key]: v })}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function DesignPanel() {
  const theme = useConfigStore((s) => s.config.theme)
  const setTheme = useConfigStore((s) => s.setTheme)
  const updateTheme = useConfigStore((s) => s.updateTheme)
  const resolved = useMemo(() => resolveTheme(theme), [theme])

  const activePresetId = useMemo(() => {
    for (const preset of themePresets) {
      const match = Object.keys(preset.theme).every(
        (k) => resolved[k as keyof ThemeConfig] === preset.theme[k as keyof ThemeConfig]
      )
      if (match) return preset.id
    }
    return null
  }, [resolved])

  return (
    <div className="px-3.5 py-3.5">
      {/* Preset grid */}
      <div className="mb-4">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-text-3 mb-2">Presets</div>
        <div className="grid grid-cols-2 gap-1.5">
          {themePresets.map((preset) => (
            <button
              key={preset.id}
              onClick={() => setTheme(preset.theme)}
              className={`p-2 rounded-lg border transition-all text-left ${
                activePresetId === preset.id
                  ? 'border-green bg-green/5'
                  : 'border-border-default bg-bg-2 hover:border-border-hover hover:bg-bg-3'
              }`}
            >
              <div className="flex gap-0.5 mb-1.5">
                <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: preset.theme.bg0 }} />
                <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: preset.theme.bg2 }} />
                <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: preset.theme.accent }} />
                <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: preset.theme.text0 }} />
              </div>
              <div className="text-[10px] font-medium truncate">{preset.name}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Color sections */}
      <div className="space-y-2 mb-4">
        <ColorSection
          title="Backgrounds"
          defaultOpen
          colors={[
            { key: 'bg0', label: 'Base' },
            { key: 'bg1', label: 'Surface 1' },
            { key: 'bg2', label: 'Surface 2' },
            { key: 'bg3', label: 'Surface 3' },
            { key: 'bg4', label: 'Surface 4' },
            { key: 'bg5', label: 'Surface 5' },
          ]}
        />
        <ColorSection
          title="Text"
          colors={[
            { key: 'text0', label: 'Primary' },
            { key: 'text1', label: 'Secondary' },
            { key: 'text2', label: 'Muted' },
            { key: 'text3', label: 'Dimmed' },
          ]}
        />
        <ColorSection
          title="Accent"
          defaultOpen
          colors={[
            { key: 'accent', label: 'Accent' },
            { key: 'accentDim', label: 'Accent Dim' },
          ]}
        />
        <ColorSection
          title="Borders"
          colors={[
            { key: 'borderDefault', label: 'Default' },
            { key: 'borderSubtle', label: 'Subtle' },
            { key: 'borderHover', label: 'Hover' },
          ]}
        />
      </div>

      {/* Fonts */}
      <div className="mb-4">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-text-3 mb-2">Fonts</div>
        <div className="space-y-2.5">
          {([
            { key: 'fontSans' as const, label: 'Body' },
            { key: 'fontDisplay' as const, label: 'Display' },
            { key: 'fontMono' as const, label: 'Mono' },
          ]).map(({ key, label }) => (
            <div key={key}>
              <label className="block text-[10.5px] text-text-2 mb-1">{label}</label>
              <select
                value={resolved[key]}
                onChange={(e) => updateTheme({ [key]: e.target.value })}
                className="w-full px-2 py-1.5 rounded-lg border border-border-default bg-bg-2 text-text-0 text-[11px] outline-none focus:border-green cursor-pointer"
                style={{ fontFamily: `"${resolved[key]}", sans-serif` }}
              >
                {googleFontOptions.map((f) => (
                  <option key={f} value={f}>{f}</option>
                ))}
              </select>
            </div>
          ))}
        </div>
      </div>

      {/* Radius */}
      <div className="mb-4">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-text-3 mb-2">Radius</div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-[10.5px] text-text-2 mb-1">Default</label>
            <input
              type="number"
              min={0}
              max={24}
              value={resolved.radius}
              onChange={(e) => updateTheme({ radius: Number(e.target.value) })}
              className="w-full px-2 py-1.5 rounded-lg border border-border-default bg-bg-2 text-text-0 text-[11px] outline-none focus:border-green"
            />
          </div>
          <div>
            <label className="block text-[10.5px] text-text-2 mb-1">Large</label>
            <input
              type="number"
              min={0}
              max={32}
              value={resolved.radiusLg}
              onChange={(e) => updateTheme({ radiusLg: Number(e.target.value) })}
              className="w-full px-2 py-1.5 rounded-lg border border-border-default bg-bg-2 text-text-0 text-[11px] outline-none focus:border-green"
            />
          </div>
        </div>
      </div>

      <ScaleSection />
    </div>
  )
}

/**
 * The five design levers. Each one is opt-in: an empty field means the blocks
 * keep their built-in value, and the placeholder shows what that value is.
 */
const SCALE_FIELDS = [
  { key: 'h1Size' as const, label: 'H1', fallback: 48, min: 32, max: 96, unit: 'px' },
  { key: 'h2Size' as const, label: 'H2', fallback: 30, min: 20, max: 64, unit: 'px' },
  { key: 'sectionSpacing' as const, label: 'Section', fallback: 80, min: 32, max: 160, unit: 'px' },
  { key: 'containerWidth' as const, label: 'Container', fallback: 1024, min: 960, max: 1600, unit: 'px' },
  { key: 'gutter' as const, label: 'Gutter', fallback: 40, min: 16, max: 96, unit: 'px' },
]

function ScaleSection() {
  const theme = useConfigStore((s) => s.config.theme)
  const updateTheme = useConfigStore((s) => s.updateTheme)
  const resolved = useMemo(() => resolveTheme(theme), [theme])
  const [open, setOpen] = useState(false)

  const active = SCALE_FIELDS.filter((f) => resolved[f.key] !== undefined).length

  return (
    <div className="border border-border-default rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-3 py-2 bg-bg-2 hover:bg-bg-3 transition-colors text-left"
      >
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold">Scale</span>
          <span className="text-[10px] text-text-3">
            {active === 0 ? 'default' : `${active} set`}
          </span>
        </div>
        <ChevronDown size={12} className={`text-text-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="px-3 py-2.5 space-y-2 bg-bg-1">
          <p className="text-[10px] text-text-3 leading-relaxed">
            Leave a field empty to keep the block's own value. Setting one overrides every block.
          </p>
          {SCALE_FIELDS.map((field) => (
            <div key={field.key} className="flex items-center justify-between gap-2">
              <label className="text-[10.5px] text-text-2">{field.label}</label>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  min={field.min}
                  max={field.max}
                  placeholder={String(field.fallback)}
                  value={resolved[field.key] ?? ''}
                  onChange={(e) => {
                    const raw = e.target.value
                    if (raw === '') {
                      updateTheme({ [field.key]: undefined })
                      return
                    }
                    const value = Number(raw)
                    if (Number.isFinite(value) && value >= field.min && value <= field.max) {
                      updateTheme({ [field.key]: value })
                    }
                  }}
                  className="w-[64px] px-1.5 py-1 rounded border border-border-default bg-bg-2 text-text-1 text-[10px] font-mono outline-none focus:border-green"
                />
                <span className="text-[9.5px] text-text-3 w-4">{field.unit}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
