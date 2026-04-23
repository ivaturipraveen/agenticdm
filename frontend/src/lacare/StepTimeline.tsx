import { useEffect, useState } from 'react'
import { LaCareStepEvent, getDocumentSteps } from './api'

/**
 * Per-document agent timeline that answers the client question:
 * "WHERE IS THE INPUT, WHAT HAPPENS, AND WHAT IS THE OUTPUT?"
 *
 * Each row is an agent (6 total). Expanding shows the raw input slice
 * on the left and the structured output on the right, side-by-side.
 *
 * For the NLP step, every narrative-block call to the clinical LLM is
 * expanded individually: the actual text sent + the JSON we got back +
 * duration + source (clinical-llm vs. heuristic fallback).
 */

interface Props {
  documentId: string
  runId?: string | null
}

const AGENT_META: Record<string, { label: string; color: string; bg: string }> = {
  ingest:         { label: '1 · INGEST',        color: 'text-rose-700',      bg: 'bg-rose-50 border-rose-200' },
  extraction:     { label: '2 · EXTRACTION',    color: 'text-orange-700',    bg: 'bg-orange-50 border-orange-200' },
  normalization:  { label: '3 · NORMALIZATION', color: 'text-amber-700',     bg: 'bg-amber-50 border-amber-200' },
  nlp:            { label: '4 · NARRATIVE NLP', color: 'text-violet-700',    bg: 'bg-violet-50 border-violet-200' },
  hedis:          { label: '5 · HEDIS',         color: 'text-emerald-700',   bg: 'bg-emerald-50 border-emerald-200' },
  dashboard:      { label: '6 · DASHBOARD',     color: 'text-blue-700',      bg: 'bg-blue-50 border-blue-200' },
}

export default function StepTimeline({ documentId, runId }: Props) {
  const [steps, setSteps] = useState<LaCareStepEvent[]>([])
  const [open, setOpen] = useState<Set<number>>(new Set())
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let ignore = false
    const load = async () => {
      setLoading(true)
      try {
        const res = await getDocumentSteps(documentId, runId ?? undefined)
        if (!ignore) {
          setSteps(res.items)
          setOpen(new Set(res.items.length ? [res.items[0].id] : []))
        }
      } catch {
        if (!ignore) setSteps([])
      } finally {
        if (!ignore) setLoading(false)
      }
    }
    void load()
    return () => { ignore = true }
  }, [documentId, runId])

  const toggle = (id: number) => setOpen((prev) => {
    const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n
  })

  if (loading) return <div className="text-xs text-slate-400 italic">Loading step timeline…</div>

  if (steps.length === 0) {
    return (
      <div className="text-xs text-slate-500 italic px-3 py-3 rounded-lg bg-slate-50 border border-slate-100">
        No step events yet. Run the pipeline on this document to populate its timeline.
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {steps.map((s) => {
        const meta = AGENT_META[s.agent] ?? { label: s.agent.toUpperCase(), color: 'text-slate-700', bg: 'bg-slate-50 border-slate-200' }
        const isOpen = open.has(s.id)
        return (
          <div key={s.id} className={`rounded-lg border ${meta.bg} overflow-hidden`}>
            <button
              onClick={() => toggle(s.id)}
              className="w-full text-left px-3 py-2 flex items-start gap-3 hover:bg-white/40 cursor-pointer"
            >
              <span className={`text-[10px] font-bold tracking-widest uppercase ${meta.color} whitespace-nowrap mt-0.5`}>
                {meta.label}
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-semibold text-slate-900 flex items-center gap-2">
                  {s.step_label}
                  {s.status === 'skipped' && (
                    <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-slate-200 text-slate-600">SKIPPED</span>
                  )}
                  {s.duration_ms > 0 && (
                    <span className="text-[10px] text-slate-500 font-mono">· {s.duration_ms}ms</span>
                  )}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-1 mt-0.5 text-[11px]">
                  <div className="text-slate-700"><span className="text-slate-500 font-semibold">INPUT:</span> {s.input_summary || '—'}</div>
                  <div className="text-slate-700"><span className="text-slate-500 font-semibold">OUTPUT:</span> {s.output_summary || '—'}</div>
                </div>
              </div>
              <span className="text-[10px] font-bold text-slate-500 whitespace-nowrap">{isOpen ? '▲' : '▼'}</span>
            </button>
            {isOpen && (
              <DetailPanel agent={s.agent} details={s.details || {}} event={s} />
            )}
          </div>
        )
      })}
    </div>
  )
}

// --------------------------------------------------------------------------- //
// Detail panels — each agent renders its own "before → after" view
// --------------------------------------------------------------------------- //

function BeforeAfter({
  left, leftLabel, right, rightLabel,
}: { left: any; leftLabel: string; right: any; rightLabel: string }) {
  return (
    <div className="grid md:grid-cols-2 gap-3 p-3 border-t border-white/60 bg-white/60">
      <Panel tone="slate" label={leftLabel}>{left}</Panel>
      <Panel tone="emerald" label={rightLabel}>{right}</Panel>
    </div>
  )
}

function Panel({ tone, label, children }: { tone: 'slate' | 'emerald' | 'violet' | 'rose'; label: string; children: any }) {
  const toneMap: Record<string, string> = {
    slate:   'bg-slate-900 text-slate-200 border-slate-800',
    emerald: 'bg-white text-slate-800 border-emerald-200',
    violet:  'bg-white text-slate-800 border-violet-200',
    rose:    'bg-white text-slate-800 border-rose-200',
  }
  const header: Record<string, string> = {
    slate:   'bg-slate-800 text-slate-300',
    emerald: 'bg-emerald-50 text-emerald-800',
    violet:  'bg-violet-50 text-violet-800',
    rose:    'bg-rose-50 text-rose-800',
  }
  return (
    <div className={`rounded-md border overflow-hidden ${toneMap[tone]}`}>
      <div className={`px-2 py-1 text-[10px] font-bold tracking-widest uppercase ${header[tone]}`}>
        {label}
      </div>
      <div className="p-2 text-[11px] max-h-64 overflow-auto font-mono leading-relaxed">
        {children}
      </div>
    </div>
  )
}

function DetailPanel({ agent, details, event }: { agent: string; details: Record<string, any>; event: LaCareStepEvent }) {
  if (agent === 'ingest') {
    return (
      <BeforeAfter
        leftLabel={`Raw C-CDA XML (first ${details.xml_bytes || 0} bytes)`}
        left={<pre className="whitespace-pre-wrap">{details.raw_xml_head || '(no XML captured)'}</pre>}
        rightLabel="Ingested into pipeline"
        right={
          <div className="space-y-1">
            <KV label="Document type" v={details.document_type} />
            <KV label="Scenario" v={details.scenario} />
            <KV label="Declared sections" v={(details.declared_sections || []).join(', ') || '—'} />
            <KV label="XML size" v={`${details.xml_bytes || 0} bytes`} />
          </div>
        }
      />
    )
  }

  if (agent === 'extraction') {
    const sections = details.sections as Record<string, number> | undefined
    const examples = (details.example_entries as any[]) || []
    return (
      <BeforeAfter
        leftLabel="Raw XML fragment (input to parser)"
        left={<pre className="whitespace-pre-wrap">{details.raw_xml_head || '—'}</pre>}
        rightLabel="Parsed structured output"
        right={
          <div className="space-y-2">
            {sections && (
              <div className="flex flex-wrap gap-1">
                {Object.entries(sections).map(([k, v]) => (
                  <span key={k} className="px-1.5 py-0.5 rounded bg-orange-100 text-orange-800 border border-orange-200 font-sans">
                    {k}: <strong>{v}</strong>
                  </span>
                ))}
              </div>
            )}
            {examples.length > 0 && (
              <div className="space-y-1">
                <div className="text-[10px] font-bold text-slate-600 uppercase tracking-wider font-sans">Sample entries</div>
                {examples.map((e: any, i: number) => (
                  <div key={i} className="px-1.5 py-1 rounded bg-orange-50 border border-orange-100 font-sans">
                    <span className="text-orange-700 font-semibold">[{e.section}]</span>{' '}
                    {e.display || e.value || '—'}
                    {e.code && <span className="text-slate-500 ml-1">({e.code_system || '?'}:{e.code})</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        }
      />
    )
  }

  if (agent === 'normalization') {
    const bySystem = details.by_code_system as Record<string, number> | undefined
    return (
      <div className="p-3 border-t border-white/60 bg-white/60 text-[11px]">
        <div className="font-bold text-amber-800 mb-1 text-[10px] tracking-widest uppercase">Codes mapped by system</div>
        <div className="flex flex-wrap gap-1">
          {bySystem && Object.entries(bySystem).map(([k, v]) => (
            <span key={k} className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-200">
              {k}: <strong>{v}</strong>
            </span>
          ))}
          {details.unmapped > 0 && (
            <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200">
              Unmapped narrative-only: <strong>{details.unmapped}</strong>
            </span>
          )}
        </div>
      </div>
    )
  }

  if (agent === 'nlp') {
    const blocks = (details.blocks as any[]) || []
    const facts = (details.facts_extracted as Record<string, number>) || {}
    if (blocks.length === 0) {
      return (
        <div className="p-3 border-t border-white/60 bg-white/60 text-[11px] text-slate-600">
          No narrative blocks qualified for NLP on this document (they were either empty or below the 40-character threshold).
        </div>
      )
    }
    return (
      <div className="p-3 border-t border-white/60 bg-white/60 text-[11px] space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] font-bold uppercase tracking-wider text-violet-800">
            Facts extracted (total across {blocks.length} call{blocks.length === 1 ? '' : 's'})
          </span>
          {Object.entries(facts).map(([k, v]) => (
            <span key={k} className="px-1.5 py-0.5 rounded bg-violet-100 text-violet-800 border border-violet-200 font-sans">
              {k}: <strong>{v}</strong>
            </span>
          ))}
        </div>
        {blocks.map((b, i) => (
          <div key={i} className="rounded-md border border-violet-200 overflow-hidden">
            <div className="px-2 py-1.5 bg-violet-50 text-violet-900 text-[11px] flex items-center gap-2 flex-wrap">
              <span className="font-bold">Call #{i + 1}</span>
              <span className="text-violet-700">· section <b>{b.section}</b></span>
              <span className="text-violet-700">· {b.input_chars} chars in</span>
              <span className="text-violet-700">· {b.duration_ms}ms</span>
              <span className={`ml-auto px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider ${
                b.source === 'clinical-llm'
                  ? 'bg-violet-600 text-white'
                  : b.source === 'heuristic-after-llm-error'
                    ? 'bg-amber-100 text-amber-800 border border-amber-300'
                    : 'bg-slate-200 text-slate-700'
              }`}>
                {b.source || 'heuristic'}
              </span>
            </div>
            <div className="grid md:grid-cols-2 gap-0">
              <div className="p-2 bg-slate-900 text-slate-200 text-[11px] max-h-56 overflow-auto">
                <div className="text-[9px] tracking-widest uppercase text-slate-400 font-bold mb-1">Input (sent to NLP)</div>
                <pre className="whitespace-pre-wrap leading-relaxed font-mono">{b.input_text}</pre>
              </div>
              <div className="p-2 bg-white text-slate-800 max-h-56 overflow-auto border-l border-violet-100">
                <div className="text-[9px] tracking-widest uppercase text-slate-500 font-bold mb-1">Output (structured JSON)</div>
                <pre className="whitespace-pre-wrap leading-relaxed font-mono text-[11px]">
                  {JSON.stringify(prune(b.output), null, 2)}
                </pre>
                {b.llm_error && (
                  <div className="mt-1 text-[10px] text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200 font-sans">
                    NLP call failed, fell back to heuristic: {b.llm_error}
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (agent === 'hedis') {
    const hits = (details.hits as any[]) || []
    return (
      <div className="p-3 border-t border-white/60 bg-white/60 text-[11px] space-y-2">
        {hits.length > 0 ? (
          hits.map((h: any, i: number) => (
            <div key={i} className="px-2 py-1.5 rounded bg-white border border-emerald-200">
              <div className="flex items-center justify-between">
                <span className="font-bold text-emerald-700">{h.measure}</span>
                <span className="text-slate-600">{Math.round((h.confidence || 0) * 100)}% conf</span>
              </div>
              <div className="text-slate-700 mt-0.5">{h.summary}</div>
              {h.section && <div className="text-[10px] text-slate-500 mt-0.5">from {h.section}</div>}
            </div>
          ))
        ) : (
          <div className="text-slate-500 italic">No HEDIS hits matched for this document.</div>
        )}
      </div>
    )
  }

  return (
    <div className="p-3 border-t border-white/60 bg-white/60 text-[11px]">
      <pre className="font-mono text-[10px] text-slate-700 whitespace-pre-wrap">
        {JSON.stringify(details, null, 2)}
      </pre>
    </div>
  )
}

function KV({ label, v }: { label: string; v: any }) {
  if (v === null || v === undefined || v === '') return null
  return (
    <div className="flex items-start gap-2 font-sans">
      <span className="text-[10px] text-slate-500 uppercase tracking-wider mt-0.5 w-32 shrink-0">{label}</span>
      <span className="text-[11px] text-slate-800">{String(v)}</span>
    </div>
  )
}

function prune(obj: any): any {
  if (Array.isArray(obj)) return obj.length ? obj : undefined
  if (obj && typeof obj === 'object') {
    const o: Record<string, any> = {}
    for (const [k, v] of Object.entries(obj)) {
      if (k === 'source') { o[k] = v; continue }
      if (Array.isArray(v) && v.length === 0) continue
      const p = prune(v)
      if (p !== undefined && p !== '' && !(Array.isArray(p) && p.length === 0)) o[k] = p
    }
    return o
  }
  return obj
}
