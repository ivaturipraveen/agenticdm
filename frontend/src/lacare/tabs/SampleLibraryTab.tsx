import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import {
  LaCareSample, LaCareSampleFacet, LaCareSamplePreview,
  listSamples, getSamplePreview,
} from '../api'

interface Props {
  activeRunInfo: { active: boolean; run_id?: string } | null
  onRunFromSamples: (sampleIds: string[], useAi: boolean) => void | Promise<void>
}

const SCENARIO_COLOR: Record<string, { tile: string; badge: string; dot: string }> = {
  FUM_CLOSED:        { tile: 'border-emerald-200', badge: 'bg-emerald-50 text-emerald-700 border-emerald-200', dot: 'bg-emerald-500' },
  FUM_CLOSED_30:     { tile: 'border-emerald-200', badge: 'bg-emerald-50 text-emerald-700 border-emerald-200', dot: 'bg-emerald-500' },
  FUA_CLOSED:        { tile: 'border-teal-200',    badge: 'bg-teal-50 text-teal-700 border-teal-200',          dot: 'bg-teal-500' },
  CBP_CONTROLLED:    { tile: 'border-blue-200',    badge: 'bg-blue-50 text-blue-700 border-blue-200',          dot: 'bg-blue-500' },
  CBP_UNCONTROLLED:  { tile: 'border-amber-200',   badge: 'bg-amber-50 text-amber-700 border-amber-200',       dot: 'bg-amber-500' },
  HBD_CONTROLLED:    { tile: 'border-violet-200',  badge: 'bg-violet-50 text-violet-700 border-violet-200',    dot: 'bg-violet-500' },
  HBD_UNCONTROLLED:  { tile: 'border-rose-200',    badge: 'bg-rose-50 text-rose-700 border-rose-200',          dot: 'bg-rose-500' },
  MRP_CLOSED:        { tile: 'border-indigo-200',  badge: 'bg-indigo-50 text-indigo-700 border-indigo-200',    dot: 'bg-indigo-500' },
  NO_EVIDENCE:       { tile: 'border-slate-200',   badge: 'bg-slate-50 text-slate-600 border-slate-200',       dot: 'bg-slate-400' },
}

export default function SampleLibraryTab({ activeRunInfo, onRunFromSamples }: Props) {
  const [samples, setSamples] = useState<LaCareSample[]>([])
  const [facets, setFacets] = useState<LaCareSampleFacet[]>([])
  const [seeded, setSeeded] = useState<number>(0)
  const [loading, setLoading] = useState(true)
  const [scenario, setScenario] = useState('')
  const [search, setSearch] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [useAi, setUseAi] = useState(true)
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const [preview, setPreview] = useState<LaCareSamplePreview | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const res = await listSamples({ scenario, search, limit: 500 })
      setSamples(res.items)
      setFacets(res.facets)
      setSeeded(res.seeded)
      if (!focusedId && res.items.length > 0) {
        setFocusedId(res.items[0].sample_id)
      }
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Could not load samples')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() /* eslint-disable-line */ }, [scenario])
  useEffect(() => {
    const t = setTimeout(() => { void load() }, 220)
    return () => clearTimeout(t)
    /* eslint-disable-next-line */
  }, [search])

  useEffect(() => {
    if (!focusedId) { setPreview(null); return }
    let ignore = false
    setPreviewLoading(true)
    getSamplePreview(focusedId)
      .then((p) => { if (!ignore) setPreview(p) })
      .catch(() => { if (!ignore) setPreview(null) })
      .finally(() => { if (!ignore) setPreviewLoading(false) })
    return () => { ignore = true }
  }, [focusedId])

  const togglePick = (id: string) => {
    setPicked((prev) => {
      const n = new Set(prev)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })
  }

  const pickOnly = (id: string) => {
    setPicked(new Set([id]))
    setFocusedId(id)
  }

  const facetsByScenario = useMemo(() => {
    const m: Record<string, number> = {}
    facets.forEach((f) => { m[f.scenario] = (m[f.scenario] || 0) + f.count })
    return m
  }, [facets])

  const scenarioOptions = useMemo(
    () => Array.from(new Set(samples.map((s) => s.scenario))).sort(),
    [samples],
  )

  const startRun = async () => {
    if (activeRunInfo?.active) {
      toast.error('Another run is already in progress. Wait for it to finish.')
      return
    }
    if (picked.size === 0) {
      toast.error('Select at least one sample to process.')
      return
    }
    await onRunFromSamples(Array.from(picked), useAi)
    setPicked(new Set())
  }

  return (
    <div className="p-8 max-w-[1500px] mx-auto">
      <div className="flex items-start justify-between gap-6 flex-wrap mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">CCDA Sample Library</h1>
          <p className="text-sm text-slate-500 mt-1 max-w-2xl">
            {seeded} curated HL7 C-CDA documents already in the database. Pick one to
            preview its parsed contents, then run the agentic pipeline and watch every
            step unfold.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="px-2.5 py-1 rounded-full bg-slate-100 border border-slate-200 text-slate-700 font-semibold">
            {seeded} in DB
          </span>
          <span className="px-2.5 py-1 rounded-full bg-rose-50 border border-rose-200 text-rose-700 font-semibold">
            {picked.size} selected
          </span>
        </div>
      </div>

      {/* Scenario quick-filter chips */}
      <div className="flex flex-wrap gap-2 mb-4">
        <Chip active={scenario === ''} onClick={() => setScenario('')}>
          All <span className="text-slate-400 ml-1">· {seeded}</span>
        </Chip>
        {Object.keys(facetsByScenario).sort().map((s) => (
          <Chip key={s} active={scenario === s} onClick={() => setScenario(s)} color={SCENARIO_COLOR[s]?.dot || 'bg-slate-400'}>
            {s} <span className="text-slate-400 ml-1">· {facetsByScenario[s]}</span>
          </Chip>
        ))}
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search patient / summary…"
          className="ml-auto px-3 py-1.5 rounded-md border border-slate-200 text-sm w-64"
        />
      </div>

      <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,560px)] gap-5">
        {/* LEFT: selectable sample cards */}
        <div>
          {loading ? (
            <div className="p-16 text-center text-slate-400 text-sm border border-slate-200 rounded-2xl bg-white">Loading samples…</div>
          ) : samples.length === 0 ? (
            <div className="p-16 text-center text-slate-400 text-sm border border-slate-200 rounded-2xl bg-white">
              No samples match the filter.
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 gap-3">
              {scenarioOptions.map((opt) => (
                <span key={`legend-${opt}`} className="hidden" />
              ))}
              {samples.map((s) => {
                const c = SCENARIO_COLOR[s.scenario] || SCENARIO_COLOR.NO_EVIDENCE
                const isFocused = focusedId === s.sample_id
                const isPicked = picked.has(s.sample_id)
                return (
                  <div
                    key={s.sample_id}
                    onClick={() => setFocusedId(s.sample_id)}
                    className={`relative p-4 rounded-2xl bg-white border-2 transition-all cursor-pointer
                      ${isFocused ? 'border-rose-500 shadow-md' : `${c.tile} hover:border-slate-300`}
                    `}
                  >
                    <label
                      className="absolute top-3 right-3 flex items-center"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        checked={isPicked}
                        onChange={() => togglePick(s.sample_id)}
                        className="h-4 w-4 accent-rose-600"
                      />
                    </label>
                    <div className="flex items-center gap-2 mb-2">
                      <span className={`inline-block w-2 h-2 rounded-full ${c.dot}`} />
                      <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md border ${c.badge}`}>
                        {s.scenario}
                      </span>
                      {s.expected_measure && (
                        <span className="text-[10px] font-bold text-slate-500 ml-auto mr-6">→ {s.expected_measure}</span>
                      )}
                    </div>
                    <div className="font-semibold text-sm text-slate-900">{s.patient_name || '—'}</div>
                    <div className="text-[11px] text-slate-500 font-mono mt-0.5">{s.patient_id}</div>
                    <div className="text-xs text-slate-600 mt-2 line-clamp-2">{s.summary || s.scenario_label}</div>
                    <div className="flex gap-4 text-[11px] text-slate-500 mt-3">
                      <span><strong className="text-slate-700">{s.section_count}</strong> sections</span>
                      <span><strong className="text-slate-700">{s.entry_count}</strong> entries</span>
                      <span><strong className="text-slate-700">{s.narrative_chars}</strong> narrative chars</span>
                    </div>
                    <div className="mt-3 flex items-center justify-between">
                      <span className="text-[10px] text-slate-400 uppercase tracking-wider">{s.document_type}</span>
                      <button
                        onClick={(e) => { e.stopPropagation(); pickOnly(s.sample_id) }}
                        className="text-[11px] font-semibold text-rose-700 hover:underline"
                      >
                        Select only this
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* RIGHT: preview panel */}
        <aside className="rounded-2xl border border-slate-200 bg-white overflow-hidden self-start sticky top-4">
          <div className="px-5 py-3 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
            <div>
              <div className="text-[10px] font-bold tracking-widest uppercase text-slate-500">Preview</div>
              <h2 className="text-sm font-semibold text-slate-900">
                {preview ? preview.patient?.name || preview.sample_id : 'Select a sample'}
              </h2>
            </div>
            {preview?.expected_measure && (
              <span className="px-2 py-0.5 rounded-md text-[10px] font-bold border bg-rose-50 text-rose-700 border-rose-200">
                Expects {preview.expected_measure}
              </span>
            )}
          </div>

          <div className="max-h-[60vh] overflow-auto">
            {previewLoading ? (
              <div className="p-10 text-center text-slate-400 text-sm">Loading preview…</div>
            ) : !preview ? (
              <div className="p-10 text-center text-slate-400 text-sm">Pick a sample card on the left to see what the pipeline will process.</div>
            ) : (
              <div className="p-5 space-y-5">
                {/* Header stats */}
                <div className="grid grid-cols-3 gap-2">
                  <Stat label="Sections" value={preview.sections.length} />
                  <Stat label="Entries" value={preview.total_entries} />
                  <Stat label="Narrative chars" value={preview.total_narrative_chars} />
                </div>

                {/* Patient / encounter */}
                <div className="grid grid-cols-2 gap-3 text-[12px]">
                  <KV k="Patient" v={preview.patient?.name || '—'} />
                  <KV k="Patient ID" v={preview.patient?.id || '—'} mono />
                  <KV k="DOB" v={preview.patient?.birth_time || '—'} />
                  <KV k="Gender" v={preview.patient?.gender || '—'} />
                  <KV k="Facility" v={preview.encounter?.facility || '—'} />
                  <KV k="Encounter" v={(preview.encounter?.effective_time?.value) || '—'} />
                </div>

                {/* Summary */}
                {preview.summary && (
                  <div className="text-[12px] text-slate-700 px-3 py-2 rounded-lg bg-slate-50 border border-slate-100">
                    {preview.summary}
                  </div>
                )}

                {/* Sections */}
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-2">Sections</div>
                  <div className="space-y-2">
                    {preview.sections.map((sec, i) => (
                      <details key={i} className="rounded-lg border border-slate-200 bg-white">
                        <summary className="px-3 py-2 text-[12px] font-semibold text-slate-800 cursor-pointer flex items-center justify-between">
                          <span>{sec.name}</span>
                          <span className="text-[11px] font-normal text-slate-500">{sec.entry_count} entries · {sec.narrative_chars} nar.chars</span>
                        </summary>
                        <div className="px-3 pb-3 space-y-2">
                          {sec.sample_entries.length > 0 && (
                            <div className="space-y-1">
                              {sec.sample_entries.map((e, j) => {
                                const display = asText(e.display) || asText(e.value) || '—'
                                const valueStr = asText(e.value)
                                const unitStr = asText(e.unit)
                                const codeStr = asText(e.code)
                                const codeSys = asText(e.code_system)
                                return (
                                  <div key={j} className="px-2 py-1 rounded bg-slate-50 border border-slate-100 text-[11px]">
                                    <span className="text-slate-800 font-medium">{display}</span>
                                    {valueStr && unitStr && (
                                      <span className="text-slate-500"> · {valueStr} {unitStr}</span>
                                    )}
                                    {codeStr && (
                                      <span className="text-slate-500 ml-1">({codeSys}:{codeStr})</span>
                                    )}
                                  </div>
                                )
                              })}
                            </div>
                          )}
                          {sec.narrative_excerpt && (
                            <div className="px-2 py-1.5 rounded bg-violet-50 border border-violet-100 text-[11px] italic text-slate-700">
                              “{sec.narrative_excerpt}{sec.narrative_excerpt.length >= 400 ? '…' : ''}”
                            </div>
                          )}
                        </div>
                      </details>
                    ))}
                  </div>
                </div>

                {/* Expected hits */}
                {preview.expected_hits_preview.length > 0 && (
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-2">
                      Expected HEDIS hits ({preview.expected_hits_preview.length})
                    </div>
                    <div className="space-y-1">
                      {preview.expected_hits_preview.map((h, i) => (
                        <div key={i} className="px-3 py-2 rounded-lg bg-emerald-50 border border-emerald-100 text-[11px]">
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-emerald-700">{h.measure}</span>
                            <span className="text-slate-600">{Math.round((h.confidence || 0) * 100)}% conf</span>
                          </div>
                          <div className="text-slate-700 mt-0.5">{h.summary}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </aside>
      </div>

      {/* Sticky action bar */}
      <div className={`mt-5 sticky bottom-4 rounded-2xl bg-white border px-5 py-3 flex items-center gap-3 flex-wrap shadow-lg
          ${picked.size > 0 ? 'border-rose-300' : 'border-slate-200'}`}>
        <div>
          <div className="text-sm font-semibold text-slate-900">
            {picked.size === 0 ? 'No samples selected' : `${picked.size} sample${picked.size > 1 ? 's' : ''} ready to process`}
          </div>
          <div className="text-[11px] text-slate-500">
            The pipeline will run ingest → extraction → normalization → NLP → HEDIS → rollup on your selection.
          </div>
        </div>
        <label className="flex items-center gap-2 text-xs text-slate-700 ml-4">
          <input type="checkbox" checked={useAi} onChange={(e) => setUseAi(e.target.checked)} />
          Use narrative NLP (LLM on unstructured text)
        </label>
        <div className="flex-1" />
        {activeRunInfo?.active && (
          <span className="text-[11px] font-semibold px-3 py-1.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200">
            Another run active — wait
          </span>
        )}
        <button
          onClick={() => setPicked(new Set())}
          disabled={picked.size === 0}
          className="px-3 py-2 rounded-md text-xs font-medium text-slate-600 hover:bg-slate-50 border border-slate-200 disabled:opacity-40"
        >
          Clear selection
        </button>
        <button
          onClick={startRun}
          disabled={picked.size === 0 || activeRunInfo?.active}
          className="px-5 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Run pipeline →
        </button>
      </div>
    </div>
  )
}

function Chip({ children, active, onClick, color }: {
  children: any; active: boolean; onClick: () => void; color?: string
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-semibold
        ${active ? 'border-rose-400 bg-rose-50 text-rose-700' : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'}`}
    >
      {color && <span className={`w-1.5 h-1.5 rounded-full ${color}`} />}
      {children}
    </button>
  )
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="px-3 py-2 rounded-lg border border-slate-200 bg-slate-50">
      <div className="text-[10px] font-bold tracking-wider uppercase text-slate-500">{label}</div>
      <div className="text-base font-semibold text-slate-900">{value}</div>
    </div>
  )
}

function KV({ k, v, mono }: { k: string; v: any; mono?: boolean }) {
  const safe = asText(v)
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">{k}</div>
      <div className={`text-slate-800 ${mono ? 'font-mono text-[11px]' : ''}`}>{safe || '—'}</div>
    </div>
  )
}

// Coerce an unknown value (string / number / null / object) into a safe
// React text node. Prevents crashes when the backend returns a structured
// code-dict (e.g. {code, system, display}) where the UI expects a scalar.
function asText(v: any): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (typeof v === 'object') {
    return (
      v.display ||
      v.value ||
      v.text ||
      v.name ||
      v.code ||
      ''
    )
  }
  return ''
}
