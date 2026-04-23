import { useMemo, useState } from 'react'
import { LaCareDashboard, LaCareHit } from '../api'

interface Props {
  evidence: LaCareHit[]
  dashboard: LaCareDashboard | null
}

const MEASURE_TINT: Record<string, { bg: string; text: string; ring: string }> = {
  FUM: { bg: 'bg-rose-50', text: 'text-rose-700', ring: 'ring-rose-200' },
  FUA: { bg: 'bg-orange-50', text: 'text-orange-700', ring: 'ring-orange-200' },
  CBP: { bg: 'bg-sky-50', text: 'text-sky-700', ring: 'ring-sky-200' },
  HBD: { bg: 'bg-violet-50', text: 'text-violet-700', ring: 'ring-violet-200' },
  MRP: { bg: 'bg-emerald-50', text: 'text-emerald-700', ring: 'ring-emerald-200' },
}

export default function EvidenceTab({ evidence, dashboard }: Props) {
  const [measureFilter, setMeasureFilter] = useState<string>('')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<LaCareHit | null>(null)

  const filtered = useMemo(() => {
    let rows = evidence.filter(h => h.satisfied)
    if (measureFilter) rows = rows.filter(h => h.measure === measureFilter)
    if (search) {
      const s = search.toLowerCase()
      rows = rows.filter(h =>
        h.patient_name.toLowerCase().includes(s) ||
        h.patient_id.toLowerCase().includes(s) ||
        (h.summary || '').toLowerCase().includes(s),
      )
    }
    return rows
  }, [evidence, measureFilter, search])

  const measureCodes = dashboard ? Object.keys(dashboard.by_measure) : ['FUM', 'FUA', 'CBP', 'HBD', 'MRP']

  return (
    <div className="flex h-full">
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="px-8 pt-8 pb-4">
          <h1 className="text-2xl font-semibold text-slate-900">HEDIS Evidence Findings</h1>
          <p className="text-sm text-slate-500 mt-1">Each row is a quality measure hit sourced from a CDA document. Click a row to inspect the evidence.</p>
        </div>

        <div className="px-8 pb-4 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white p-1">
            <button
              onClick={() => setMeasureFilter('')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${!measureFilter ? 'bg-slate-900 text-white' : 'text-slate-600'}`}
            >
              All ({filtered.length})
            </button>
            {measureCodes.map(m => {
              const count = dashboard?.by_measure?.[m]?.count ?? 0
              if (count === 0) return null
              return (
                <button
                  key={m}
                  onClick={() => setMeasureFilter(m === measureFilter ? '' : m)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${measureFilter === m ? 'bg-rose-600 text-white' : 'text-slate-600 hover:text-slate-900'}`}
                >
                  {m} ({count})
                </button>
              )
            })}
          </div>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search member name / ID / summary…"
            className="flex-1 max-w-sm px-3.5 py-2 rounded-xl border border-slate-200 text-sm bg-white focus:outline-none focus:border-rose-400"
          />
        </div>

        <div className="flex-1 overflow-auto px-8 pb-8">
          <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600 sticky top-0">
                <tr className="text-left">
                  <th className="px-4 py-3 font-semibold text-xs uppercase tracking-wider">Measure</th>
                  <th className="px-4 py-3 font-semibold text-xs uppercase tracking-wider">Member</th>
                  <th className="px-4 py-3 font-semibold text-xs uppercase tracking-wider">Evidence</th>
                  <th className="px-4 py-3 font-semibold text-xs uppercase tracking-wider">Source Doc</th>
                  <th className="px-4 py-3 font-semibold text-xs uppercase tracking-wider">Numer. Date</th>
                  <th className="px-4 py-3 font-semibold text-xs uppercase tracking-wider text-right">Conf.</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={6} className="text-center py-16 text-slate-400">
                      No evidence found. Run a batch to populate this view.
                    </td>
                  </tr>
                )}
                {filtered.map((h, i) => {
                  const tint = MEASURE_TINT[h.measure] ?? MEASURE_TINT.FUM
                  return (
                    <tr
                      key={`${h.patient_id}-${h.measure}-${i}`}
                      onClick={() => setSelected(h)}
                      className={`hover:bg-slate-50 cursor-pointer ${selected === h ? 'bg-rose-50/50' : ''}`}
                    >
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold ring-1 ${tint.bg} ${tint.text} ${tint.ring}`}>
                          {h.measure}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-semibold text-slate-900">{h.patient_name}</div>
                        <div className="text-xs text-slate-500 font-mono">{h.patient_id}</div>
                      </td>
                      <td className="px-4 py-3 text-slate-700 max-w-md">{h.summary}</td>
                      <td className="px-4 py-3">
                        <div className="text-slate-800">{h.source_document_type}</div>
                        <div className="text-xs text-slate-500 font-mono">{h.source_document_id.slice(0, 10)}…</div>
                      </td>
                      <td className="px-4 py-3 text-slate-700 font-mono text-xs">{h.numerator_date || '—'}</td>
                      <td className="px-4 py-3 text-right">
                        <span className={`text-sm font-semibold
                          ${h.confidence >= 0.9 ? 'text-emerald-700' : h.confidence >= 0.75 ? 'text-amber-700' : 'text-red-700'}`}>
                          {(h.confidence * 100).toFixed(0)}%
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {selected && (
        <aside className="w-[420px] border-l border-slate-200 bg-white overflow-auto">
          <div className="p-6 sticky top-0 bg-white border-b border-slate-200 flex items-start justify-between">
            <div>
              <div className="text-[10px] font-bold tracking-widest uppercase text-rose-600">{selected.measure}</div>
              <h3 className="text-lg font-semibold text-slate-900 mt-1 leading-tight">{selected.measure_name}</h3>
            </div>
            <button onClick={() => setSelected(null)} className="text-slate-400 hover:text-slate-700 text-xl leading-none">×</button>
          </div>

          <div className="p-6 space-y-5 text-sm">
            <Section label="Member">
              <div className="font-semibold text-slate-900">{selected.patient_name}</div>
              <div className="text-slate-500 font-mono text-xs">{selected.patient_id}</div>
            </Section>

            <Section label="Summary">
              <p className="text-slate-700 leading-relaxed">{selected.summary}</p>
            </Section>

            <Section label="Evidence Detail">
              <div className="space-y-2 text-xs">
                <Row k="Document Type" v={selected.source_document_type} />
                <Row k="Document ID" v={<span className="font-mono">{selected.source_document_id}</span>} />
                <Row k="Section" v={selected.source_section} />
                <Row k="Evidence Type" v={selected.evidence_type} />
                <Row k="Numerator Date" v={selected.numerator_date || '—'} />
                <Row k="Denominator Date" v={selected.denominator_date || '—'} />
                <Row k="Confidence" v={`${(selected.confidence * 100).toFixed(0)}%`} />
                {selected.window && <Row k="Window" v={selected.window} />}
                {selected.sys && selected.dia && <Row k="BP" v={`${selected.sys}/${selected.dia} mmHg`} />}
                {selected.a1c && <Row k="HbA1c" v={`${selected.a1c}%`} />}
                {selected.med_count && <Row k="Meds reconciled" v={selected.med_count} />}
              </div>
            </Section>

            <Section label="Claims vs CDA">
              <div className="text-xs p-3 rounded-lg bg-rose-50 border border-rose-100 text-rose-900 leading-snug">
                Claims data did not record this numerator event. CDA evidence closes the gap
                and qualifies this member as a HEDIS supplemental-data hit.
              </div>
            </Section>
          </div>
        </aside>
      )}
    </div>
  )
}

function Section({ label, children }: { label: string; children: any }) {
  return (
    <div>
      <div className="text-[10px] font-bold tracking-widest uppercase text-slate-400 mb-1.5">{label}</div>
      {children}
    </div>
  )
}

function Row({ k, v }: { k: string; v: any }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-slate-500">{k}</dt>
      <dd className="text-slate-800 text-right">{v}</dd>
    </div>
  )
}
