import { useEffect, useRef, useState } from 'react'
import { ACRONYMS } from './glossary'

/**
 * Tiny circular "?" icon that reveals a hover/click tooltip with an
 * expanded explanation. Designed to sit inline with text so every
 * acronym on screen has a discoverable full-form expansion.
 *
 *   <HelpTip title="What is a C-CDA?">
 *     Consolidated Clinical Document Architecture — the HL7 XML format
 *     LA Care receives from provider EHRs via HIE feeds.
 *   </HelpTip>
 */
interface Props {
  /** Short heading shown in bold at the top of the tooltip. */
  title?: string
  /** Body content. */
  children: React.ReactNode
  /** Visual size (default small). */
  size?: 'xs' | 'sm' | 'md'
  /** Tooltip alignment relative to the trigger. */
  align?: 'left' | 'right' | 'center'
  /** Use a slate "i" look instead of rose "?" for variety. */
  variant?: 'question' | 'info'
}

export default function HelpTip({ title, children, size = 'sm', align = 'left', variant = 'question' }: Props) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const box = size === 'xs'
    ? 'h-3.5 w-3.5 text-[8px]'
    : size === 'md'
      ? 'h-5 w-5 text-[11px]'
      : 'h-4 w-4 text-[9px]'

  const alignCls = align === 'right' ? 'right-0' : align === 'center' ? 'left-1/2 -translate-x-1/2' : 'left-0'

  const tone = variant === 'info'
    ? 'bg-slate-200 text-slate-600 hover:bg-slate-300'
    : 'bg-rose-100 text-rose-700 hover:bg-rose-200'

  const glyph = variant === 'info' ? 'i' : '?'

  return (
    <span ref={wrapRef} className="relative inline-flex items-center align-middle ml-1 select-none">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(o => !o) }}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        className={`inline-flex items-center justify-center rounded-full font-bold leading-none cursor-help border border-transparent focus:outline-none ${box} ${tone}`}
        aria-label={title || 'More info'}
      >
        {glyph}
      </button>
      {open && (
        <span
          className={`absolute top-full mt-1.5 z-50 w-72 rounded-lg border border-slate-200 bg-white shadow-xl p-3 text-[11px] leading-relaxed text-slate-700 ${alignCls}`}
          onClick={(e) => e.stopPropagation()}
        >
          {title && (
            <div className="text-[11px] font-bold text-slate-900 mb-1">{title}</div>
          )}
          <div className="normal-case tracking-normal font-normal">{children}</div>
        </span>
      )}
    </span>
  )
}

/**
 * Inline acronym with built-in hover tooltip. Looks up the term in the
 * shared glossary — just write <Acronym>HEDIS</Acronym> and you get
 * dotted-underline text + a hover tooltip with the expanded form.
 *
 * If a term isn't in the glossary the component falls back to rendering
 * plain text (so it never breaks if someone misspells an acronym).
 */
export function Acronym({ children, term }: { children?: React.ReactNode; term?: string }) {
  const key = term || (typeof children === 'string' ? children : '')
  const entry = ACRONYMS[key.trim().toUpperCase()] || ACRONYMS[key.trim()]
  if (!entry) return <>{children || key}</>
  return (
    <span className="inline-flex items-baseline">
      <span className="border-b border-dotted border-slate-400 cursor-help" title={`${entry.full} — ${entry.description}`}>
        {children || key}
      </span>
      <HelpTip title={`${key} — ${entry.full}`} size="xs" variant="info">
        {entry.description}
      </HelpTip>
    </span>
  )
}
