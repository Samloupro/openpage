/**
 * src/editor/AiEditPopover.tsx
 *
 * Owns: the one-line "change this" box in the editor toolbar — instruction in,
 * patch applied to the live config, undo entry pushed.
 *
 * Open when: the edit flow gains options (target a page, preview a diff).
 *
 * Never: send the whole config to the model. editSiteConfig builds the outline.
 */

import { useEffect, useRef, useState } from 'react'
import { Loader2, Sparkles, X } from 'lucide-react'
import { toast } from 'sonner'
import { useConfigStore } from '@/store/configStore'
import { editSiteConfig } from '@/lib/edit-site'

const EXAMPLES = [
  'Rewrite the hero headline in a warmer tone',
  'Switch the accent colour to a deep green',
  'Add an FAQ block before the footer',
  'Move the testimonials above the features',
]

export function AiEditPopover() {
  const [open, setOpen] = useState(false)
  const [instruction, setInstruction] = useState('')
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  const config = useConfigStore((s) => s.config)
  const activePageId = useConfigStore((s) => s.activePageId)
  const applyConfig = useConfigStore((s) => s.applyConfig)

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  useEffect(() => {
    if (!open) return
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  useEffect(() => () => abortRef.current?.abort(), [])

  async function submit() {
    const text = instruction.trim()
    if (!text || busy) return

    const controller = new AbortController()
    abortRef.current = controller
    setBusy(true)

    try {
      const result = await editSiteConfig(config, text, {
        activePageId,
        signal: controller.signal,
      })
      applyConfig(result.config, 'AI edit')

      const count = result.applied
      const detail = result.summary || `${count} change${count === 1 ? '' : 's'} applied`
      toast.success(detail, {
        description: result.skipped.length
          ? `${result.skipped.length} proposed change(s) skipped`
          : undefined,
      })

      setInstruction('')
      setOpen(false)
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return
      toast.error(error instanceof Error ? error.message : 'Edit failed')
    } finally {
      abortRef.current = null
      setBusy(false)
    }
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((value) => !value)}
        className={`h-7 px-2 rounded flex items-center gap-1 text-[11px] transition-all ${
          open ? 'bg-green-glow text-green' : 'text-text-3 hover:text-text-1 hover:bg-bg-3'
        }`}
        title="Edit with AI"
        aria-label="Edit with AI"
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <Sparkles size={13} />
        <span>Edit</span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => !busy && setOpen(false)} />
          <div
            role="dialog"
            aria-label="Edit with AI"
            className="absolute top-full right-0 mt-1 z-20 w-[340px] bg-bg-2 border border-border-default rounded-lg p-3 shadow-[0_8px_24px_rgba(0,0,0,0.4)]"
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-semibold text-text-1">Edit with AI</span>
              <button
                onClick={() => !busy && setOpen(false)}
                className="w-5 h-5 rounded flex items-center justify-center text-text-3 hover:text-text-0 hover:bg-bg-3 transition-colors"
                aria-label="Close"
              >
                <X size={12} />
              </button>
            </div>

            <textarea
              ref={inputRef}
              value={instruction}
              onChange={(event) => setInstruction(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault()
                  void submit()
                }
              }}
              rows={3}
              placeholder="Change the hero headline to…"
              disabled={busy}
              className="w-full px-2 py-1.5 rounded border border-border-default bg-bg-3 text-text-0 text-[11.5px] leading-relaxed outline-none focus:border-green resize-none disabled:opacity-60"
            />

            {!instruction.trim() && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {EXAMPLES.map((example) => (
                  <button
                    key={example}
                    onClick={() => {
                      setInstruction(example)
                      inputRef.current?.focus()
                    }}
                    className="px-1.5 py-0.5 rounded bg-bg-3 text-text-3 text-[10px] hover:text-text-1 hover:bg-bg-4 transition-colors"
                  >
                    {example.length > 34 ? `${example.slice(0, 33)}…` : example}
                  </button>
                ))}
              </div>
            )}

            <div className="mt-2 flex items-center justify-between">
              <span className="text-[10px] text-text-3">Only the change is sent</span>
              <button
                onClick={() => void submit()}
                disabled={!instruction.trim() || busy}
                className="h-7 px-3 rounded-lg bg-green text-bg-0 text-[11.5px] font-semibold hover:bg-green/90 transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
              >
                {busy ? (
                  <>
                    <Loader2 size={12} className="animate-spin" />
                    <span>Applying…</span>
                  </>
                ) : (
                  <span>Apply</span>
                )}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
