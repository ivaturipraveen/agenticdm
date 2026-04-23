import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  PieChart, Pie, Cell, Legend,
} from 'recharts'
import { LaCareDashboard, LaCareStatus } from '../api'

interface Props {
  dashboard: LaCareDashboard | null
  status: LaCareStatus | null
  runId: string | null
  isRunning: boolean
  onGoToLibrary?: () => void
}

const MEASURE_COLORS: Record<string, string> = {
  FUM: '#e11d48',
  FUA: '#f97316',
  CBP: '#0891b2',
  HBD: '#7c3aed',
  MRP: '#059669',
}

const CONFIDENCE_COLORS = ['#059669', '#eab308', '#dc2626']

const PIPELINE_STEPS = [
  {
    n: 1,
    key: 'ingest',
    title: 'Ingest',
    tag: 'Discovery',
    body: 'Accept bulk C-CDA XML (CCD, Discharge Summary, Progress Note, Referral, H&P, Consult). Validate HL7 namespaces, handle malformed documents, tolerate missing sections.',
  },
  {
    n: 2,
    key: 'extraction',
    title: 'Extraction',
    tag: 'Parser',
    body: 'Parse urn:hl7-org:v3 XML. Pull header (patient, author, encounter) and every clinical section by LOINC code — Problems, Medications, Results, Vitals, Procedures, Encounters.',
  },
  {
    n: 3,
    key: 'normalization',
    title: 'Normalization',
    tag: 'Code Mapping',
    body: 'Normalise to standard value sets. Map ICD-9 → ICD-10, local codes → SNOMED / LOINC / RxNorm. Flag unmapped codes for review instead of dropping them.',
  },
  {
    n: 4,
    key: 'nlp',
    title: 'Narrative NLP',
    tag: 'Clinical LLM',
    body: 'Where structured entries are missing, send narrative text to the clinical LLM to extract dates, diagnoses, labs, vitals and meds. PHI is scrubbed with Presidio before leaving the platform.',
  },
  {
    n: 5,
    key: 'hedis',
    title: 'HEDIS Matching',
    tag: 'Rules Engine',
    body: 'Run member-level evidence against NCQA value sets for FUM, FUA, CBP, HBD and MRP. Each hit ships with a confidence score, a source section reference and a reason.',
  },
  {
    n: 6,
    key: 'dashboard',
    title: 'Rollup',
    tag: 'Surface',
    body: 'Aggregate evidence into the dashboard: gap-closure count, evidence by measure, document-type mix, revenue impact. One click to drill from a KPI to the source document.',
  },
]

const MEASURES_CATALOG = [
  { code: 'FUM', name: 'Follow-Up After ED Visit for Mental Illness', source: 'Encounters · Discharge Instructions' },
  { code: 'FUA', name: 'Follow-Up After ED Visit for AOD',           source: 'Encounters · Discharge Instructions' },
  { code: 'CBP', name: 'Controlling High Blood Pressure',              source: 'Vital Signs · Results' },
  { code: 'HBD', name: 'HbA1c Control for Diabetes',                   source: 'Results (Lab Values)' },
  { code: 'MRP', name: 'Medication Reconciliation Post-Discharge',     source: 'Medications · Plan of Care' },
]

export default function OverviewTab({
  dashboard, status, runId, isRunning, onGoToLibrary,
}: Props) {
  const hasData = dashboard && dashboard.total_documents > 0
  const totalDocs = status?.total_documents ?? dashboard?.total_documents ?? 0
  const hasRun = !!runId

  const measureChart = dashboard ? Object.values(dashboard.by_measure).map(m => ({
    code: m.code, name: m.code, fullName: m.name, count: m.count,
    revenue: dashboard.revenue.by_measure[m.code]?.amount ?? 0,
  })) : []
  const confidenceData = dashboard
    ? Object.entries(dashboard.confidence_buckets).map(([k, v]) => ({ name: k, value: v }))
    : []
  const docTypeData = dashboard
    ? Object.entries(dashboard.by_document_type).map(([k, v]) => ({ name: k, value: v }))
    : []

  const topMeasureByCount = measureChart.slice().sort((a, b) => b.count - a.count)[0]

  return (
    <div className="p-8 max-w-[1400px] mx-auto">
      {/* Hero */}
      <section className="mb-6 p-8 rounded-3xl bg-gradient-to-br from-rose-600 via-rose-700 to-pink-800 text-white relative overflow-hidden">
        <div className="absolute inset-0 opacity-10" style={{ background: 'radial-gradient(circle at 80% 20%, white 1px, transparent 1px)', backgroundSize: '40px 40px' }} />
        <div className="relative">
          <div className="text-xs font-bold tracking-widest uppercase text-rose-200">LA Care Health Plan</div>
          <h1 className="mt-2 text-3xl md:text-4xl font-semibold leading-tight max-w-3xl">
            Turn millions of CCD/CDA documents into HEDIS quality evidence
          </h1>
          <p className="mt-4 text-rose-100 text-base max-w-3xl leading-relaxed">
            Ingest C-CDA XML, extract structured clinical data, apply narrative NLP where
            entries are missing, and match the findings against NCQA HEDIS value sets to
            surface the quality evidence that claims data alone cannot see.
          </p>
          {onGoToLibrary && (
            <div className="mt-6 flex items-center gap-3">
              <button
                onClick={onGoToLibrary}
                className="px-5 py-2.5 rounded-lg bg-white text-rose-700 font-semibold text-sm hover:bg-rose-50"
              >
                Open Sample Library →
              </button>
              <span className="text-xs text-rose-100/80">
                Pick any C-CDA from the curated library, preview it, and run the pipeline.
              </span>
            </div>
          )}
        </div>
      </section>

      {/* KPI row */}
      <section className="grid md:grid-cols-4 gap-4 mb-6">
        <Kpi
          label="Documents Processed"
          value={dashboard?.total_documents ?? 0}
          helper={isRunning ? 'streaming…' : 'in the active run'}
          accent="rose"
        />
        <Kpi
          label="HEDIS Evidence Hits"
          value={dashboard?.total_evidence ?? 0}
          helper="surfaced from clinical sections + narrative"
          accent="blue"
        />
        <Kpi
          label="Gap-Closure Members"
          value={dashboard?.gap_closure_members ?? 0}
          helper="unique member × measure pairs"
          accent="emerald"
        />
        <Kpi
          label="Est. Quality Bonus Recovery"
          value={dashboard ? `$${Math.round(dashboard.revenue.total_usd).toLocaleString()}` : '$0'}
          helper="illustrative PMPM impact"
          accent="violet"
        />
      </section>

      {/* Pipeline explainer */}
      <section className="mb-8">
        <div className="flex items-end justify-between mb-3">
          <div>
            <div className="text-[10px] font-bold tracking-widest uppercase text-slate-500">Agentic Pipeline</div>
            <h2 className="text-lg font-semibold text-slate-900">Six agents turn raw XML into HEDIS evidence</h2>
          </div>
          <span className="text-xs text-slate-500">
            {hasRun
              ? `Run ${runId?.slice(0, 8)}… · ${totalDocs} docs`
              : 'Pick samples in the Sample Library to start a run.'}
          </span>
        </div>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
          {PIPELINE_STEPS.map(step => {
            const agent = status?.agents?.[step.key]
            const state = agent?.status ?? 'idle'
            return (
              <div
                key={step.key}
                className={`relative p-5 rounded-2xl bg-white border transition-all
                  ${state === 'running' ? 'border-rose-300 shadow-sm shadow-rose-100' :
                    state === 'complete' ? 'border-emerald-300' :
                    state === 'failed' ? 'border-red-300' :
                    'border-slate-200'}`}
              >
                <div className={`absolute -top-3 left-4 h-6 w-6 rounded-full flex items-center justify-center text-[11px] font-bold
                  ${state === 'running' ? 'bg-rose-600 text-white animate-pulse' :
                    state === 'complete' ? 'bg-emerald-500 text-white' :
                    state === 'failed' ? 'bg-red-500 text-white' :
                    'bg-slate-200 text-slate-600'}`}>
                  {step.n}
                </div>
                <div className="ml-8">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-base font-semibold text-slate-900">{step.title}</div>
                      <div className="text-[10px] font-bold tracking-widest uppercase text-slate-500">{step.tag}</div>
                    </div>
                    <span className={`text-[10px] font-bold tracking-widest uppercase px-2 py-0.5 rounded-full
                      ${state === 'running' ? 'bg-rose-50 text-rose-700' :
                        state === 'complete' ? 'bg-emerald-50 text-emerald-700' :
                        state === 'failed' ? 'bg-red-50 text-red-700' :
                        'bg-slate-100 text-slate-500'}`}>
                      {state}
                    </span>
                  </div>
                  <p className="text-[13px] text-slate-600 leading-relaxed mt-2">{step.body}</p>
                  {agent?.last_action && (
                    <div className="text-[11px] font-mono text-slate-700 bg-slate-50 rounded-md px-2.5 py-2 border border-slate-200 leading-relaxed mt-3">
                      {agent.last_action}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </section>

      {/* Charts or empty state */}
      {hasData ? (
        <section className="grid lg:grid-cols-3 gap-4 mb-8">
          <Card title="Evidence by HEDIS Measure" className="lg:col-span-2">
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={measureChart} margin={{ left: 6, right: 6, top: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#475569' }} />
                <YAxis tick={{ fontSize: 12, fill: '#475569' }} allowDecimals={false} />
                <Tooltip
                  contentStyle={{ fontSize: 12, borderRadius: 8, borderColor: '#e2e8f0' }}
                  formatter={(v: any, _n, p: any) => [v, p.payload.fullName]}
                />
                <Bar dataKey="count" radius={[8, 8, 0, 0]}>
                  {measureChart.map((d, i) => (
                    <Cell key={i} fill={MEASURE_COLORS[d.code] ?? '#64748b'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <div className="mt-4 grid grid-cols-2 md:grid-cols-3 gap-3">
              {measureChart.map(m => (
                <div key={m.code} className="px-3 py-2 rounded-lg border border-slate-200 bg-slate-50">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold tracking-widest uppercase" style={{ color: MEASURE_COLORS[m.code] }}>{m.code}</span>
                    <span className="text-sm font-bold text-slate-900">{m.count}</span>
                  </div>
                  <div className="text-[11px] text-slate-600 leading-tight mt-0.5">{m.fullName}</div>
                  <div className="text-[11px] font-medium text-emerald-600 mt-1">${Math.round(m.revenue).toLocaleString()} impact</div>
                </div>
              ))}
            </div>
          </Card>

          <Card title="Match Confidence">
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={confidenceData} dataKey="value" cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={2}>
                  {confidenceData.map((_, i) => (<Cell key={i} fill={CONFIDENCE_COLORS[i]} />))}
                </Pie>
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          </Card>

          <Card title="Document Type Mix" className="lg:col-span-2">
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={docTypeData} layout="vertical" margin={{ left: 20, right: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 12, fill: '#475569' }} />
                <YAxis dataKey="name" type="category" tick={{ fontSize: 12, fill: '#334155' }} width={170} />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                <Bar dataKey="value" fill="#e11d48" radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </Card>

          <Card title="Run Narrative">
            <dl className="text-sm space-y-3">
              <Row k="Run ID" v={<span className="font-mono text-xs">{dashboard.run_id ? dashboard.run_id.slice(0, 12) + '…' : '—'}</span>} />
              <Row k="Status" v={<span className="capitalize font-medium text-slate-800">{dashboard.status}</span>} />
              <Row k="Documents" v={dashboard.total_documents} />
              <Row k="Gap closures" v={`${dashboard.gap_closure_members} members`} />
              <Row k="Revenue impact" v={`$${Math.round(dashboard.revenue.total_usd).toLocaleString()}`} />
              {topMeasureByCount && (
                <Row k="Top measure" v={`${topMeasureByCount.code} · ${topMeasureByCount.count} hits`} />
              )}
            </dl>
            <div className="mt-5 p-3 rounded-lg bg-rose-50 border border-rose-100 text-[12px] text-rose-900 leading-snug">
              “From {dashboard.total_documents.toLocaleString()} CDAs we found{' '}
              <strong>{dashboard.total_evidence}</strong> HEDIS hits across{' '}
              <strong>{Object.keys(dashboard.by_measure).filter(k => dashboard.by_measure[k].count > 0).length} measures</strong>{' '}
              that claims data alone would have missed.”
            </div>
          </Card>
        </section>
      ) : (
        <section className="rounded-2xl border-2 border-dashed border-slate-300 bg-white p-12 text-center mb-8">
          <div className="inline-flex items-center justify-center h-14 w-14 rounded-2xl bg-rose-100 text-rose-600 mb-4">
            <svg className="w-7 h-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h12l4 4v12H4z"/><path d="M14 4v6h6"/></svg>
          </div>
          <h2 className="text-xl font-semibold text-slate-900">No run yet</h2>
          <p className="text-slate-500 mt-2 max-w-md mx-auto text-sm">
            Pick a batch of C-CDA documents in the <strong>Sample Library</strong> tab, preview
            what the pipeline will see, then start a run to populate this dashboard.
          </p>
          {onGoToLibrary && (
            <button
              onClick={onGoToLibrary}
              className="mt-5 px-5 py-2.5 rounded-lg bg-rose-600 text-white font-semibold text-sm hover:bg-rose-500"
            >
              Open Sample Library
            </button>
          )}
        </section>
      )}

      {/* HEDIS measures catalog */}
      <section>
        <div className="text-[10px] font-bold tracking-widest uppercase text-slate-500 mb-2">
          HEDIS Measures Evaluated
        </div>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
          {MEASURES_CATALOG.map((m) => {
            const count = dashboard?.by_measure?.[m.code]?.count ?? 0
            return (
              <div
                key={m.code}
                className="p-4 rounded-2xl bg-white border border-slate-200"
                style={{ borderTop: `3px solid ${MEASURE_COLORS[m.code]}` }}
              >
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold tracking-widest uppercase" style={{ color: MEASURE_COLORS[m.code] }}>
                    {m.code}
                  </span>
                  <span className="text-[11px] text-slate-500">
                    {count > 0 ? <strong className="text-slate-800">{count} hits</strong> : 'no hits yet'}
                  </span>
                </div>
                <div className="text-sm font-semibold text-slate-900 mt-1 leading-snug">{m.name}</div>
                <div className="text-[11px] text-slate-500 mt-1.5">
                  <span className="font-semibold text-slate-600">Source sections:</span> {m.source}
                </div>
              </div>
            )
          })}
        </div>
      </section>
    </div>
  )
}

function Kpi({ label, value, helper, accent }: { label: string; value: number | string; helper?: string; accent: string }) {
  const accentRing: Record<string, string> = {
    rose:    'from-rose-500 to-rose-700',
    blue:    'from-blue-500 to-indigo-600',
    emerald: 'from-emerald-500 to-teal-600',
    violet:  'from-violet-500 to-fuchsia-600',
  }
  return (
    <div className="relative p-5 rounded-2xl bg-white border border-slate-200 overflow-hidden">
      <div className={`absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r ${accentRing[accent]}`} />
      <div className="text-[11px] font-bold tracking-widest uppercase text-slate-500">{label}</div>
      <div className="mt-2 text-3xl font-semibold text-slate-900">{value}</div>
      {helper && <div className="text-xs text-slate-500 mt-1">{helper}</div>}
    </div>
  )
}

function Card({ title, children, className = '' }: { title: string; children: any; className?: string }) {
  return (
    <div className={`p-5 rounded-2xl bg-white border border-slate-200 ${className}`}>
      <h3 className="text-sm font-semibold text-slate-800 mb-3">{title}</h3>
      {children}
    </div>
  )
}

function Row({ k, v }: { k: string; v: any }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-slate-500">{k}</dt>
      <dd className="font-medium text-slate-800">{v}</dd>
    </div>
  )
}
