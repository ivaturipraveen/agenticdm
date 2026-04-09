import { useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'

interface RunSummary {
  run_id: string; dataset_id: string; total: number; success: number; failed: number
  status: string; loaded_at: string | null; fhir_endpoint: string | null
}

interface FhirRecord {
  id: number; run_id: string; dataset_id: string; resource_type: string; resource_id: string
  resource: Record<string, unknown>; source: Record<string, unknown> | null
  status: string; validation_errors: string[] | null
  fhir_endpoint: string | null; fhir_response: Record<string, unknown> | null; loaded_at: string
}

interface RunDetail {
  summary: RunSummary | null; records: FhirRecord[]
}

function StatusBadge({ status }: { status: string }) {
  const s = status === 'success' ? 'bg-emerald-100 text-emerald-700' : status === 'failed' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
  return <span className={clsx('px-2.5 py-1 rounded-full text-xs font-semibold capitalize', s)}>{status}</span>
}

function RecordStatusDot({ status }: { status: string }) {
  return <span className={clsx('w-2.5 h-2.5 rounded-full inline-block', status === 'success' ? 'bg-emerald-500' : status === 'failed' ? 'bg-red-500' : 'bg-amber-500')} />
}

/* ── Integrity checks derived from the resource ────────────────────── */
function deriveChecks(rec: FhirRecord): { field: string; sourceVal: string; fhirVal: string; pass: boolean; reason?: string }[] {
  const res = rec.resource
  const src = rec.source || {}
  const checks: { field: string; sourceVal: string; fhirVal: string; pass: boolean; reason?: string }[] = []

  if (rec.resource_type === 'Patient') {
    const fhirId = String(res.id ?? '')
    const srcId  = String((src as any).member_id ?? '')
    checks.push({ field: 'member_id → Patient.id', sourceVal: srcId, fhirVal: fhirId, pass: !!fhirId })
    const names = (res.name as any)?.[0]
    const fname = String((src as any).first_name ?? ''), fhirGiven = String(names?.given?.[0] ?? '')
    checks.push({ field: 'first_name → Patient.name.given', sourceVal: fname, fhirVal: fhirGiven, pass: !!fhirGiven })
    const lname = String((src as any).last_name ?? ''), fhirFamily = String(names?.family ?? '')
    checks.push({ field: 'last_name → Patient.name.family', sourceVal: lname, fhirVal: fhirFamily, pass: !!fhirFamily })
    const dob = String((src as any).date_of_birth ?? ''), fhirDob = String(res.birthDate ?? '')
    checks.push({ field: 'date_of_birth → Patient.birthDate', sourceVal: dob, fhirVal: fhirDob, pass: !!fhirDob && fhirDob.match(/^\d{4}-\d{2}-\d{2}$/) !== null })
    const g = String((src as any).gender ?? ''), fg = String(res.gender ?? '')
    checks.push({ field: 'gender → Patient.gender', sourceVal: g, fhirVal: fg, pass: ['male','female','other','unknown'].includes(fg) })
  }

  if (rec.resource_type === 'Claim') {
    const diag = (res.diagnosis as any)?.[0]?.diagnosisCodeableConcept?.coding?.[0]?.code
    const srcIcd = String((src as any).icd10_primary ?? '')
    checks.push({ field: 'icd10_primary → Claim.diagnosis', sourceVal: srcIcd, fhirVal: diag ?? '—', pass: !!diag && /^[A-Z]\d{2}/.test(diag) })
    const npi = String((src as any).provider_npi ?? '')
    const fhirProv = String((res.provider as any)?.reference ?? '')
    checks.push({ field: 'provider_npi → Claim.provider.reference', sourceVal: npi, fhirVal: fhirProv, pass: !!fhirProv })
    const amt = String((src as any).claim_amount ?? ''), fhirAmt = String((res.total as any)?.value ?? '')
    checks.push({ field: 'claim_amount → Claim.total.value', sourceVal: amt, fhirVal: fhirAmt, pass: !!fhirAmt && parseFloat(fhirAmt) > 0 })
    const dos = String((src as any).date_of_service ?? ''), fhirDos = String((res.billablePeriod as any)?.start ?? '')
    checks.push({ field: 'date_of_service → Claim.billablePeriod.start', sourceVal: dos, fhirVal: fhirDos, pass: !!fhirDos })
  }

  if (rec.resource_type === 'Coverage') {
    const benef = String((res.beneficiary as any)?.reference ?? '')
    checks.push({ field: 'member_id → Coverage.beneficiary', sourceVal: String((src as any).member_id ?? ''), fhirVal: benef, pass: benef.startsWith('Patient/') })
    const st = String(res.status ?? '')
    checks.push({ field: 'status → Coverage.status', sourceVal: String((src as any).status ?? ''), fhirVal: st, pass: ['active','cancelled','draft','entered-in-error'].includes(st.toLowerCase()) })
  }

  if (rec.validation_errors?.length) {
    checks.push({ field: 'FHIR validation', sourceVal: '—', fhirVal: rec.validation_errors.join('; '), pass: false, reason: 'Validation failed' })
  }

  return checks
}

/* ── Record detail panel ──────────────────────────────────────────── */
function RecordDetail({ rec, onClose }: { rec: FhirRecord; onClose: () => void }) {
  const checks = useMemo(() => deriveChecks(rec), [rec])
  const passCount = checks.filter(c => c.pass).length
  const matchRate = checks.length > 0 ? Math.round((passCount / checks.length) * 100) : 0
  const tc = { Patient: 'text-blue-700', Coverage: 'text-violet-700', Claim: 'text-emerald-700' }[rec.resource_type] || 'text-slate-700'

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-200 bg-white shrink-0">
        <button onClick={onClose} className="px-3 py-1.5 rounded-xl border border-slate-300 text-slate-600 hover:bg-slate-100 text-sm bg-white">← Back</button>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className={clsx('font-bold text-lg', tc)}>{rec.resource_type}</span>
            <span className="text-slate-400 text-sm font-mono">/{rec.resource_id?.slice(0, 16)}…</span>
            <StatusBadge status={rec.status} />
          </div>
          <div className="text-slate-400 text-xs mt-0.5 font-mono">Run #{rec.run_id.slice(-8).toUpperCase()} · {new Date(rec.loaded_at).toLocaleString()}</div>
        </div>
        <div className="text-center">
          <div className={clsx('text-2xl font-bold font-mono', matchRate >= 90 ? 'text-emerald-700' : matchRate >= 60 ? 'text-amber-700' : 'text-red-700')}>{matchRate}%</div>
          <div className="text-xs text-slate-400">field match</div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-5 space-y-5 bg-slate-50">
        {/* Summary row */}
        <div className="grid grid-cols-4 gap-4">
          {[
            { l: 'Resource Type', v: rec.resource_type, c: tc },
            { l: 'Status', v: rec.status, c: rec.status === 'success' ? 'text-emerald-700' : 'text-red-700' },
            { l: 'Fields Checked', v: `${passCount}/${checks.length}`, c: 'text-slate-900' },
            { l: 'FHIR Response', v: String((rec.fhir_response as any)?.status_code ?? '—'), c: (rec.fhir_response as any)?.status_code === 200 ? 'text-emerald-700' : 'text-amber-700' },
          ].map(m => (
            <div key={m.l} className="rounded-2xl border border-slate-200 bg-white p-4 text-center shadow-sm">
              <div className={clsx('text-2xl font-bold', m.c)}>{m.v}</div>
              <div className="text-xs text-slate-400 mt-1">{m.l}</div>
            </div>
          ))}
        </div>

        {/* FHIR endpoint + response */}
        {rec.fhir_endpoint && (
          <div className="rounded-2xl border border-cyan-200 bg-cyan-50 p-4 shadow-sm">
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">FHIR Endpoint</div>
            <div className="font-mono text-cyan-800 text-sm">{rec.fhir_endpoint}</div>
            {rec.fhir_response && (
              <div className={clsx('mt-2 text-xs font-semibold', (rec.fhir_response as any).status_code === 200 ? 'text-emerald-700' : 'text-amber-700')}>
                Response: {(rec.fhir_response as any).message}
              </div>
            )}
          </div>
        )}

        {/* Field-level integrity check table */}
        <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm">
          <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 text-sm font-bold text-slate-900">
            Field-level Validation — Source → FHIR
          </div>
          <table className="w-full text-xs">
            <thead><tr className="bg-slate-50 border-b border-slate-100">
              <th className="text-left px-4 py-2.5 text-slate-500 font-semibold w-[35%]">Field Mapping</th>
              <th className="text-left px-4 py-2.5 text-slate-500 font-semibold w-[25%]">Source Value</th>
              <th className="text-left px-4 py-2.5 text-slate-500 font-semibold w-[25%]">FHIR Value</th>
              <th className="text-left px-4 py-2.5 text-slate-500 font-semibold w-[15%]">Result</th>
            </tr></thead>
            <tbody>
              {checks.map((c, i) => (
                <tr key={i} className={clsx('border-b border-slate-100 last:border-0', !c.pass && 'bg-red-50/40')}>
                  <td className="px-4 py-2.5 font-mono text-slate-700 text-xs">{c.field}</td>
                  <td className="px-4 py-2.5 font-mono text-slate-600 max-w-[160px] truncate text-xs">{c.sourceVal || '—'}</td>
                  <td className="px-4 py-2.5 font-mono text-blue-700 max-w-[160px] truncate text-xs">{c.fhirVal || '—'}</td>
                  <td className="px-4 py-2.5">
                    <span className={clsx('px-2.5 py-1 rounded-full text-[10px] font-bold', c.pass ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700')}>
                      {c.pass ? 'PASS' : 'FAIL'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Side-by-side: source vs FHIR JSON */}
        <div className="grid grid-cols-2 gap-4">
          <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm">
            <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 text-xs font-bold text-slate-700">Source Row (PostgreSQL)</div>
            <pre className="p-4 text-xs text-slate-700 overflow-x-auto whitespace-pre-wrap max-h-72">{JSON.stringify(rec.source, null, 2)}</pre>
          </div>
          <div className="rounded-2xl border border-blue-200 bg-blue-50 overflow-hidden shadow-sm">
            <div className="px-4 py-3 border-b border-blue-200 bg-blue-50 text-xs font-bold text-blue-800">FHIR R4 Resource (Stored)</div>
            <pre className="p-4 text-xs text-slate-700 overflow-x-auto whitespace-pre-wrap max-h-72">{JSON.stringify(rec.resource, null, 2)}</pre>
          </div>
        </div>

        {rec.validation_errors && rec.validation_errors.length > 0 && (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-4 shadow-sm">
            <div className="text-sm font-bold text-red-800 mb-2">FHIR Validation Errors</div>
            {rec.validation_errors.map((e, i) => <div key={i} className="text-xs text-red-700 mt-1">• {e}</div>)}
          </div>
        )}
      </div>
    </div>
  )
}

/* ── Run records list ─────────────────────────────────────────────── */
function RunRecords({ summary, onBack }: { summary: RunSummary; onBack: () => void }) {
  const [records, setRecords] = useState<FhirRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'success' | 'failed'>('all')
  const [typeFilter, setTypeFilter] = useState<string>('All')
  const [selected, setSelected] = useState<FhirRecord | null>(null)

  useEffect(() => {
    setLoading(true)
    const q = new URLSearchParams()
    if (filter !== 'all') q.set('status', filter)
    if (typeFilter !== 'All') q.set('resource_type', typeFilter)
    q.set('limit', '500')
    fetch(`/api/fhir/runs/${summary.run_id}/records?${q}`).then(r => r.json()).then(d => { setRecords(d); setLoading(false) }).catch(() => setLoading(false))
  }, [summary.run_id, filter, typeFilter])

  if (selected) return <RecordDetail rec={selected} onClose={() => setSelected(null)} />

  const byType = useMemo(() => {
    const m: Record<string, number> = {}
    records.forEach(r => { m[r.resource_type] = (m[r.resource_type] || 0) + 1 })
    return m
  }, [records])

  const matchRate = summary.total > 0 ? Math.round((summary.success / summary.total) * 100) : 0

  return (
    <div className="flex flex-col h-full bg-slate-50">
      {/* Header */}
      <div className="flex items-center gap-4 px-5 py-4 border-b border-slate-200 bg-white shrink-0 shadow-sm">
        <button onClick={onBack} className="px-3 py-1.5 rounded-xl border border-slate-300 text-slate-600 hover:bg-slate-100 text-sm bg-white">← Back</button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <span className="text-slate-900 font-bold text-lg">{summary.dataset_id}</span>
            <StatusBadge status={summary.status} />
          </div>
          <div className="text-slate-400 text-xs font-mono mt-0.5">
            Run #{summary.run_id.slice(-8).toUpperCase()} · {summary.fhir_endpoint || 'endpoint'}
          </div>
        </div>
        <div className="flex gap-4 text-center text-sm shrink-0">
          <div><div className="text-2xl font-bold font-mono text-slate-900">{summary.total}</div><div className="text-xs text-slate-400">total</div></div>
          <div><div className="text-2xl font-bold font-mono text-emerald-700">{summary.success}</div><div className="text-xs text-slate-400">success</div></div>
          <div><div className="text-2xl font-bold font-mono text-red-600">{summary.failed}</div><div className="text-xs text-slate-400">failed</div></div>
          <div><div className={clsx('text-2xl font-bold font-mono', matchRate >= 90 ? 'text-emerald-700' : matchRate >= 60 ? 'text-amber-700' : 'text-red-700')}>{matchRate}%</div><div className="text-xs text-slate-400">match</div></div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 px-5 py-3 border-b border-slate-200 bg-white">
        {(['all', 'success', 'failed'] as const).map(s => (
          <button key={s} onClick={() => setFilter(s)} className={clsx('px-3 py-1.5 rounded-xl text-xs font-semibold border capitalize', filter === s ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-600 bg-white')}>{s}</button>
        ))}
        <div className="w-px h-5 bg-slate-200 mx-1" />
        {['All', ...Object.keys(byType)].map(t => (
          <button key={t} onClick={() => setTypeFilter(t)} className={clsx('px-3 py-1.5 rounded-xl text-xs font-semibold border', typeFilter === t ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-600 bg-white')}>{t}{byType[t] ? ` (${byType[t]})` : ''}</button>
        ))}
      </div>

      {/* Records list */}
      <div className="flex-1 overflow-y-auto p-4">
        {loading ? <div className="text-slate-400 p-8 text-center">Loading records…</div> : (
          <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm">
            <table className="w-full text-sm">
              <thead><tr className="bg-slate-50 border-b border-slate-200">
                <th className="text-left px-4 py-3 text-slate-500 font-semibold w-8">#</th>
                <th className="text-left px-4 py-3 text-slate-500 font-semibold">Type</th>
                <th className="text-left px-4 py-3 text-slate-500 font-semibold">Resource ID</th>
                <th className="text-left px-4 py-3 text-slate-500 font-semibold">Status</th>
                <th className="text-left px-4 py-3 text-slate-500 font-semibold">Issues</th>
                <th className="text-left px-4 py-3 text-slate-500 font-semibold">Loaded</th>
                <th className="text-left px-4 py-3 text-slate-500 font-semibold w-16"></th>
              </tr></thead>
              <tbody>
                {records.map((rec, idx) => (
                  <tr key={rec.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50 cursor-pointer" onClick={() => setSelected(rec)}>
                    <td className="px-4 py-3 text-slate-400 text-xs font-mono">{idx + 1}</td>
                    <td className="px-4 py-3"><span className={clsx('px-2 py-0.5 rounded-lg text-xs font-semibold', rec.resource_type === 'Patient' ? 'bg-blue-50 text-blue-700' : rec.resource_type === 'Coverage' ? 'bg-violet-50 text-violet-700' : 'bg-emerald-50 text-emerald-700')}>{rec.resource_type}</span></td>
                    <td className="px-4 py-3 font-mono text-slate-600 text-xs max-w-[200px] truncate">{rec.resource_id || '—'}</td>
                    <td className="px-4 py-3"><div className="flex items-center gap-1.5"><RecordStatusDot status={rec.status} /><span className="text-xs text-slate-700 capitalize">{rec.status}</span></div></td>
                    <td className="px-4 py-3 text-xs text-red-600">{rec.validation_errors?.length ? `${rec.validation_errors.length} error${rec.validation_errors.length > 1 ? 's' : ''}` : <span className="text-emerald-600">None</span>}</td>
                    <td className="px-4 py-3 text-xs text-slate-500">{new Date(rec.loaded_at).toLocaleTimeString()}</td>
                    <td className="px-4 py-3 text-xs text-slate-400">View →</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {records.length === 0 && <div className="p-8 text-center text-slate-400">No records match the selected filters.</div>}
          </div>
        )}
      </div>
    </div>
  )
}

/* ── Main FHIR Endpoint page ─────────────────────────────────────── */
export default function FhirDataPage() {
  const [runs, setRuns] = useState<RunSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedRun, setSelectedRun] = useState<RunSummary | null>(null)

  const load = () => {
    setLoading(true)
    fetch('/api/fhir/runs').then(r => r.json()).then(d => { setRuns(Array.isArray(d) ? d : []); setLoading(false) }).catch(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const clearAll = async () => {
    await fetch('/api/fhir/resources', { method: 'DELETE' })
    setSelectedRun(null)
    load()
  }

  if (selectedRun) return <RunRecords summary={selectedRun} onBack={() => setSelectedRun(null)} />

  const totals = runs.reduce((a, r) => ({ total: a.total + r.total, success: a.success + r.success, failed: a.failed + r.failed }), { total: 0, success: 0, failed: 0 })

  return (
    <div className="flex flex-col h-full bg-slate-50">
      {/* Page header */}
      <div className="px-6 py-5 border-b border-slate-200 bg-white shrink-0 shadow-sm">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">FHIR Endpoint Registry</h1>
            <p className="text-slate-500 text-sm mt-1">Every migration run that loaded resources to the FHIR endpoint. Click a run to inspect record-level details, source vs FHIR comparison, and validation results.</p>
          </div>
          <button onClick={clearAll} className="px-3 py-2 rounded-xl border border-red-200 text-red-700 hover:bg-red-50 text-sm bg-white shrink-0">Clear All FHIR Data</button>
        </div>
        {totals.total > 0 && (
          <div className="grid grid-cols-3 gap-4 mt-4">
            {[
              { l: 'Total Resources Ingested', v: totals.total, c: 'text-slate-900' },
              { l: 'Successful', v: totals.success, c: 'text-emerald-700' },
              { l: 'Failed', v: totals.failed, c: totals.failed > 0 ? 'text-red-700' : 'text-slate-400' },
            ].map(m => (
              <div key={m.l} className="rounded-2xl border border-slate-200 bg-slate-50 px-5 py-3 flex items-center gap-4">
                <div className={clsx('text-3xl font-bold font-mono', m.c)}>{m.v}</div>
                <div className="text-sm text-slate-500">{m.l}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Run list */}
      <div className="flex-1 overflow-y-auto p-5">
        {loading ? (
          <div className="flex items-center justify-center h-full gap-2 text-slate-400">
            <div className="w-5 h-5 border-2 border-slate-300 border-t-blue-500 rounded-full animate-spin" />Loading…
          </div>
        ) : runs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-slate-400">
            <div className="text-lg">No FHIR ingestion records yet</div>
            <div className="text-sm">Run a migration to populate this registry.</div>
          </div>
        ) : (
          <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm">
            <table className="w-full text-sm">
              <thead><tr className="bg-slate-50 border-b border-slate-200">
                <th className="text-left px-5 py-3.5 text-slate-500 font-semibold">Migration ID</th>
                <th className="text-left px-5 py-3.5 text-slate-500 font-semibold">Dataset</th>
                <th className="text-left px-5 py-3.5 text-slate-500 font-semibold">Status</th>
                <th className="text-right px-5 py-3.5 text-slate-500 font-semibold">Total</th>
                <th className="text-right px-5 py-3.5 text-slate-500 font-semibold">Success</th>
                <th className="text-right px-5 py-3.5 text-slate-500 font-semibold">Failed</th>
                <th className="text-right px-5 py-3.5 text-slate-500 font-semibold">Match %</th>
                <th className="text-left px-5 py-3.5 text-slate-500 font-semibold">Ingested At</th>
                <th className="px-5 py-3.5"></th>
              </tr></thead>
              <tbody>
                {runs.map((r) => {
                  const match = r.total > 0 ? Math.round((r.success / r.total) * 100) : 0
                  return (
                    <tr key={r.run_id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50 cursor-pointer transition-colors" onClick={() => setSelectedRun(r)}>
                      <td className="px-5 py-4 font-mono text-xs text-slate-600">#{r.run_id.slice(-8).toUpperCase()}</td>
                      <td className="px-5 py-4 font-medium text-slate-900">{r.dataset_id}</td>
                      <td className="px-5 py-4"><StatusBadge status={r.status} /></td>
                      <td className="px-5 py-4 text-right font-mono font-semibold text-slate-900">{r.total}</td>
                      <td className="px-5 py-4 text-right font-mono font-semibold text-emerald-700">{r.success}</td>
                      <td className="px-5 py-4 text-right font-mono font-semibold text-red-600">{r.failed}</td>
                      <td className="px-5 py-4 text-right">
                        <span className={clsx('font-mono font-bold', match >= 90 ? 'text-emerald-700' : match >= 60 ? 'text-amber-700' : 'text-red-700')}>{match}%</span>
                      </td>
                      <td className="px-5 py-4 text-xs text-slate-500">{r.loaded_at ? new Date(r.loaded_at).toLocaleString() : '—'}</td>
                      <td className="px-5 py-4 text-slate-400 text-xs">View →</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
