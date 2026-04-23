import { useEffect, useState } from 'react'
import { getSample, LaCareHit } from '../api'
import { MEASURE_GLOSSARY } from '../glossary'
import { Acronym } from '../HelpTip'

const SCENARIOS = [
  { value: 'FUM_CLOSED', label: 'FUM — ED → BH follow-up (7-day)', measure: 'FUM' },
  { value: 'FUA_CLOSED', label: 'FUA — ED → AOD follow-up', measure: 'FUA' },
  { value: 'CBP_CONTROLLED', label: 'CBP — BP controlled', measure: 'CBP' },
  { value: 'HBD_CONTROLLED', label: 'HBD — HbA1c controlled', measure: 'HBD' },
  { value: 'MRP_CLOSED', label: 'MRP — medication reconciliation', measure: 'MRP' },
]

interface SampleState {
  metadata: any
  xml: string
  parsed: any
  hits: LaCareHit[]
}

export default function BeforeAfterTab() {
  const [scenario, setScenario] = useState('FUM_CLOSED')
  const [data, setData] = useState<SampleState | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    getSample(scenario).then(setData).finally(() => setLoading(false))
  }, [scenario])

  return (
    <div className="p-8 max-w-[1500px] mx-auto">
      <div className="mb-4 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Raw <Acronym>CDA</Acronym> vs Extracted Data</h1>
          <p className="text-sm text-slate-500 mt-1 max-w-2xl">
            Tutorial view: pick a <Acronym>HEDIS</Acronym> measure and we'll generate a canned <Acronym>C-CDA</Acronym> that demonstrates
            what that measure looks like as raw XML vs. the clean structured facts the pipeline pulls
            out. <strong>This is a teaching view</strong> — not tied to any of your processed runs.
          </p>
        </div>
        <label className="flex items-center gap-2" title="Each option is a different HEDIS quality measure. Pick one to load a canned CCDA demonstrating how that measure looks in XML vs. structured extraction.">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">HEDIS measure</span>
          <select
            value={scenario}
            onChange={e => setScenario(e.target.value)}
            className="px-3.5 py-2 rounded-xl border border-slate-200 text-sm bg-white"
          >
            {SCENARIOS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </label>
      </div>

      {/* Measure explainer: plain-English description of the selected measure */}
      {(() => {
        const s = SCENARIOS.find(x => x.value === scenario)
        const m = s ? MEASURE_GLOSSARY[s.measure] : null
        if (!m) return null
        return (
          <div className="mb-5 px-4 py-3 rounded-xl border border-rose-100 bg-rose-50/40 text-[12px] text-slate-700 leading-relaxed">
            <div className="flex items-center gap-2 mb-1">
              <span className="px-2 py-0.5 rounded-md bg-rose-600 text-white text-[10px] font-bold">{m.code}</span>
              <span className="font-semibold text-slate-900">{m.name}</span>
            </div>
            <div>{m.long}</div>
            <div className="mt-1.5 grid grid-cols-1 md:grid-cols-3 gap-x-6 gap-y-1 text-[11px]">
              <div><span className="text-slate-500 font-semibold">Numerator:</span> {m.numerator}</div>
              <div><span className="text-slate-500 font-semibold">Denominator:</span> {m.denominator}</div>
              <div><span className="text-slate-500 font-semibold">Window:</span> {m.window}</div>
            </div>
          </div>
        )
      })()}

      {loading && <div className="text-slate-400 text-sm">Loading sample…</div>}

      {data && !loading && (
        <>
          <div className="grid lg:grid-cols-2 gap-5 mb-6">
            <div className="rounded-2xl border border-slate-200 bg-slate-950 overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2.5 bg-slate-900 border-b border-slate-800">
                <div className="flex items-center gap-2 text-xs text-slate-400 font-mono">
                  <span className="h-2.5 w-2.5 rounded-full bg-red-400" />
                  Raw C-CDA XML
                </div>
                <span className="text-[10px] text-slate-500 font-mono">{data.xml.length.toLocaleString()} chars · HL7 v3</span>
              </div>
              <pre className="p-4 text-[11px] text-slate-300 font-mono overflow-auto max-h-[560px] leading-relaxed">
{data.xml}
              </pre>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2.5 bg-rose-50 border-b border-rose-100">
                <div className="flex items-center gap-2 text-xs text-rose-700 font-semibold">
                  <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
                  Extracted Clinical Data
                </div>
                <span className="text-[10px] text-slate-500 font-mono">Brightcone structured output</span>
              </div>
              <div className="p-5 space-y-4 overflow-auto max-h-[560px]">
                <div>
                  <SectionHeading>Patient</SectionHeading>
                  <KvGrid>
                    <Kv k="Name" v={data.parsed.header?.patient?.name} />
                    <Kv k="Member ID" v={data.parsed.header?.patient?.id} />
                    <Kv k="DOB" v={data.parsed.header?.patient?.dob} />
                    <Kv k="Gender" v={data.parsed.header?.patient?.gender} />
                    <Kv k="Race" v={data.parsed.header?.patient?.race} />
                    <Kv k="Ethnicity" v={data.parsed.header?.patient?.ethnicity} />
                  </KvGrid>
                </div>

                {data.parsed.header?.encounter?.facility && (
                  <div>
                    <SectionHeading>Encounter</SectionHeading>
                    <KvGrid>
                      <Kv k="Facility" v={data.parsed.header?.encounter?.facility} />
                      <Kv k="Type" v={data.parsed.header?.encounter?.type} />
                      <Kv k="Date" v={data.parsed.header?.encounter?.effective_time?.value} />
                      <Kv k="Author" v={data.parsed.header?.author?.name} />
                    </KvGrid>
                  </div>
                )}

                <SectionTable title="Problems" rows={data.parsed.sections?.problems} fields={['display', 'code']} />
                <SectionTable title="Medications" rows={data.parsed.sections?.medications} fields={['display', 'code']} getValue={(r) => ({
                  display: r.code?.display ?? '',
                  code: r.code?.code ?? '',
                })} />
                <SectionTable title="Vital Signs" rows={data.parsed.sections?.vital_signs} fields={['display', 'value', 'unit']} getValue={(r) => ({
                  display: r.code?.display ?? '',
                  value: r.value?.value ?? '',
                  unit: r.value?.unit ?? '',
                })} />
                <SectionTable title="Results" rows={data.parsed.sections?.results} fields={['display', 'value', 'unit']} getValue={(r) => ({
                  display: r.code?.display ?? '',
                  value: r.value?.value ?? '',
                  unit: r.value?.unit ?? '',
                })} />
                <SectionTable title="Encounters" rows={data.parsed.sections?.encounters} fields={['display', 'date']} getValue={(r) => ({
                  display: r.code?.display ?? '',
                  date: r.effective_time?.value ?? '',
                })} />
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-rose-100 bg-gradient-to-br from-rose-50 via-white to-white p-6">
            <div className="flex items-center gap-2 text-[10px] font-bold tracking-widest uppercase text-rose-600 mb-2">
              <span className="h-2 w-2 rounded-full bg-rose-500" />
              HEDIS Evidence Detected
            </div>
            {data.hits.length === 0 ? (
              <p className="text-sm text-slate-600">No HEDIS evidence matched for this scenario.</p>
            ) : (
              <ul className="space-y-3">
                {data.hits.map((h, i) => (
                  <li key={i} className="p-4 rounded-xl bg-white border border-rose-100">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="px-2 py-0.5 rounded-full bg-rose-600 text-white text-[11px] font-bold">{h.measure}</span>
                        <span className="ml-2 font-semibold text-slate-900">{h.measure_name}</span>
                      </div>
                      <span className={`text-sm font-semibold ${h.confidence >= 0.9 ? 'text-emerald-700' : 'text-amber-700'}`}>
                        {(h.confidence * 100).toFixed(0)}% confidence
                      </span>
                    </div>
                    <p className="text-sm text-slate-700 mt-2">{h.summary}</p>
                    <p className="text-xs text-slate-500 mt-1">Source: {h.source_document_type} · Section: {h.source_section} · Date: {h.numerator_date || '—'}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function SectionHeading({ children }: { children: any }) {
  return <div className="text-[10px] font-bold tracking-widest uppercase text-slate-400 mb-2 border-b border-slate-100 pb-1">{children}</div>
}

function KvGrid({ children }: { children: any }) {
  return <dl className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm">{children}</dl>
}

function Kv({ k, v }: { k: string; v: any }) {
  if (!v) return null
  return (
    <div className="flex items-center justify-between">
      <dt className="text-slate-500 text-xs">{k}</dt>
      <dd className="text-slate-800 font-medium text-xs">{v}</dd>
    </div>
  )
}

function SectionTable({ title, rows, fields, getValue }: { title: string; rows: any[]; fields: string[]; getValue?: (r: any) => Record<string, any> }) {
  if (!rows || rows.length === 0) return null
  return (
    <div>
      <SectionHeading>{title}</SectionHeading>
      <table className="w-full text-xs border border-slate-200 rounded-md overflow-hidden">
        <thead className="bg-slate-50">
          <tr>
            {fields.map(f => <th key={f} className="text-left px-2 py-1 text-[10px] uppercase tracking-wider text-slate-500">{f}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const mapped = getValue ? getValue(r) : {
              display: r.code?.display ?? r.value?.text ?? '',
              code: r.code?.code ?? '',
              value: r.value?.value ?? '',
              unit: r.value?.unit ?? '',
              date: r.effective_time?.value ?? '',
            }
            return (
              <tr key={i} className="border-t border-slate-100">
                {fields.map(f => <td key={f} className="px-2 py-1 text-slate-700">{(mapped as any)[f] ?? ''}</td>)}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
