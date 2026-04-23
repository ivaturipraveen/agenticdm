import { useMemo, useState } from 'react'
import { LaCareDocument, LaCareHit } from '../api'
import StepTimeline from '../StepTimeline'
import { DOC_TYPE_GLOSSARY, SCENARIO_LABEL } from '../glossary'
import { Acronym } from '../HelpTip'

interface Props {
  documents: LaCareDocument[]
  evidence: LaCareHit[]
  runId: string | null
}

export default function DocumentsTab({ documents, evidence, runId }: Props) {
  const [search, setSearch] = useState('')
  const [type, setType] = useState('')
  const [selected, setSelected] = useState<LaCareDocument | null>(null)

  const types = useMemo(() => Array.from(new Set(documents.map(d => d.document_type))).sort(), [documents])

  const filtered = useMemo(() => {
    let rows = documents
    if (type) rows = rows.filter(d => d.document_type === type)
    if (search) {
      const s = search.toLowerCase()
      rows = rows.filter(d =>
        d.patient_name?.toLowerCase().includes(s) ||
        d.patient_id?.toLowerCase().includes(s) ||
        d.facility?.toLowerCase().includes(s),
      )
    }
    return rows
  }, [documents, search, type])

  const hitsForSelected = useMemo(() => {
    if (!selected) return []
    return evidence.filter(e => e.source_document_id === selected.document_id)
  }, [selected, evidence])

  return (
    <div className="flex h-full">
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="px-8 pt-8 pb-4">
          <h1 className="text-2xl font-semibold text-slate-900">Processed Documents</h1>
          <p className="text-sm text-slate-500 mt-1 max-w-3xl">
            {documents.length} <Acronym>C-CDA</Acronym> documents processed in this run.{' '}
            <span className="text-rose-700 font-medium">
              Click any row → right panel shows the full agent trail: raw XML in, structured data out,
              and the exact text sent to the clinical <Acronym>LLM</Acronym> at every step.
            </span>
          </p>
          <p className="text-[11px] text-slate-400 mt-1">
            <strong>Type</strong> = the kind of clinical document (LOINC-coded).{' '}
            <strong>Scenario</strong> = the HEDIS gap the document was synthesised to demonstrate.{' '}
            <strong>Member ID</strong> (LAC#######) identifies the patient; <strong>Document ID</strong> identifies the CCDA file.
          </p>
        </div>

        <div className="px-8 pb-4 flex flex-wrap items-center gap-3">
          <select
            value={type}
            onChange={e => setType(e.target.value)}
            className="px-3 py-2 rounded-xl border border-slate-200 text-sm bg-white"
          >
            <option value="">All document types</option>
            {types.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by member or facility…"
            className="flex-1 max-w-sm px-3.5 py-2 rounded-xl border border-slate-200 text-sm bg-white focus:outline-none focus:border-rose-400"
          />
          <div className="text-xs text-slate-500">{filtered.length} of {documents.length}</div>
        </div>

        <div className="flex-1 overflow-auto px-8 pb-8">
          <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 sticky top-0 text-slate-600">
                <tr className="text-left">
                  <th className="px-4 py-3 font-semibold text-xs uppercase tracking-wider">Type</th>
                  <th className="px-4 py-3 font-semibold text-xs uppercase tracking-wider">Patient</th>
                  <th className="px-4 py-3 font-semibold text-xs uppercase tracking-wider">Facility</th>
                  <th className="px-4 py-3 font-semibold text-xs uppercase tracking-wider">Sections</th>
                  <th className="px-4 py-3 font-semibold text-xs uppercase tracking-wider">Entries</th>
                  <th className="px-4 py-3 font-semibold text-xs uppercase tracking-wider">Scenario</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.length === 0 && (
                  <tr><td colSpan={6} className="text-center py-16 text-slate-400">No documents match the filter.</td></tr>
                )}
                {filtered.slice(0, 300).map((d) => (
                  <tr
                    key={d.document_id}
                    onClick={() => setSelected(d)}
                    className={`hover:bg-slate-50 cursor-pointer ${selected?.document_id === d.document_id ? 'bg-rose-50/50' : ''}`}
                  >
                    <td className="px-4 py-3">
                      <span className="px-2 py-1 rounded-md bg-slate-100 text-slate-700 text-[11px] font-semibold">{d.document_type}</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900">{d.patient_name || '—'}</div>
                      <div className="text-xs text-slate-500 font-mono">{d.patient_id}</div>
                    </td>
                    <td className="px-4 py-3 text-slate-700 text-xs">{d.facility || '—'}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {d.sections.slice(0, 4).map(s => (
                          <span key={s} className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 text-[10px]">{s}</span>
                        ))}
                        {d.sections.length > 4 && <span className="text-[10px] text-slate-500">+{d.sections.length - 4}</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-700 text-xs">{d.entry_count}</td>
                    <td className="px-4 py-3">
                      <span className={`text-[11px] font-semibold ${d.scenario.includes('closed') ? 'text-emerald-700' : d.scenario.includes('controlled') ? 'text-emerald-700' : d.scenario.includes('not') ? 'text-amber-700' : 'text-slate-500'}`}>
                        {d.scenario || '—'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {filtered.length > 300 && (
            <p className="text-xs text-slate-400 mt-2">Showing first 300 rows. Refine search to narrow.</p>
          )}
        </div>
      </div>

      {selected && (
        <aside className="w-[720px] max-w-[55vw] border-l border-slate-200 bg-white overflow-auto">
          <div className="p-6 sticky top-0 bg-white border-b border-slate-200 flex items-start justify-between z-10">
            <div>
              <div className="text-[10px] font-bold tracking-widest uppercase text-rose-600">{selected.document_type}</div>
              <h3 className="text-lg font-semibold text-slate-900 mt-1">{selected.patient_name}</h3>
              <div className="text-xs text-slate-500 font-mono mt-0.5">Member ID: {selected.patient_id}</div>
              {DOC_TYPE_GLOSSARY[selected.document_type] && (
                <div className="mt-2 px-2.5 py-1.5 rounded-md bg-slate-50 border border-slate-100 text-[11px] text-slate-600 leading-snug max-w-md">
                  {DOC_TYPE_GLOSSARY[selected.document_type].purpose}
                  <span className="text-slate-400 font-mono block mt-0.5">
                    LOINC {DOC_TYPE_GLOSSARY[selected.document_type].loinc}
                  </span>
                </div>
              )}
              {selected.scenario && SCENARIO_LABEL[selected.scenario] && (
                <div className="mt-2 text-[11px] text-slate-500">
                  <span className="font-semibold text-slate-600">Scenario:</span> {SCENARIO_LABEL[selected.scenario]}
                </div>
              )}
            </div>
            <button onClick={() => setSelected(null)} className="text-slate-400 hover:text-slate-700 text-xl leading-none">×</button>
          </div>

          <div className="p-6 space-y-5 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-[10px] font-bold tracking-widest uppercase text-slate-400 mb-1.5">Encounter</div>
                <div className="text-slate-800 text-xs">{selected.facility || '—'}</div>
                <div className="text-xs text-slate-500 font-mono">{selected.encounter_date || '—'}</div>
              </div>
              <div>
                <div className="text-[10px] font-bold tracking-widest uppercase text-slate-400 mb-1.5">
                  Scale
                </div>
                <div className="text-xs text-slate-700">
                  {selected.entry_count} structured entries · {selected.narrative_chars} narrative chars
                </div>
              </div>
            </div>

            <div>
              <div className="text-[10px] font-bold tracking-widest uppercase text-slate-400 mb-1.5">Extracted Sections</div>
              <div className="flex flex-wrap gap-1.5">
                {selected.sections.map(s => (
                  <span key={s} className="px-2 py-1 rounded-md bg-rose-50 border border-rose-100 text-rose-700 text-[11px] font-semibold">
                    {s.replace('_', ' ')}
                  </span>
                ))}
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <div className="text-[10px] font-bold tracking-widest uppercase text-slate-400">
                  Agent-by-agent · input → output
                </div>
                <div className="text-[10px] text-slate-500">click any step to expand</div>
              </div>
              <StepTimeline documentId={selected.document_id} runId={runId} />
            </div>

            <div>
              <div className="text-[10px] font-bold tracking-widest uppercase text-slate-400 mb-1.5">HEDIS Evidence ({hitsForSelected.length})</div>
              {hitsForSelected.length === 0 ? (
                <p className="text-xs text-slate-500 italic">No HEDIS hits from this document.</p>
              ) : (
                <div className="space-y-2">
                  {hitsForSelected.map((h, i) => (
                    <div key={i} className="p-3 rounded-lg border border-rose-100 bg-rose-50/60">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-bold text-rose-700">{h.measure}</span>
                        <span className="text-[11px] text-slate-600">{(h.confidence * 100).toFixed(0)}% conf</span>
                      </div>
                      <p className="text-xs text-slate-800 mt-1 leading-snug">{h.summary}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {selected.warnings?.length > 0 && (
              <div>
                <div className="text-[10px] font-bold tracking-widest uppercase text-amber-600 mb-1.5">Warnings</div>
                <ul className="space-y-1 text-xs text-amber-800">
                  {selected.warnings.map((w, i) => <li key={i}>• {w}</li>)}
                </ul>
              </div>
            )}

            <div>
              <div className="text-[10px] font-bold tracking-widest uppercase text-slate-400 mb-1.5">Document ID</div>
              <div className="text-xs font-mono text-slate-600 break-all">{selected.document_id}</div>
            </div>
          </div>
        </aside>
      )}
    </div>
  )
}
