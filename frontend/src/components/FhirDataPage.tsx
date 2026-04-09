import { useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'

interface FhirRow {
  run_id: string
  dataset_id: string
  resource_type: string
  resource_id: string
  resource: Record<string, unknown>
  loaded_at: string
}

const TYPE_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  Patient:  { bg: 'bg-blue-50',   text: 'text-blue-700',   border: 'border-blue-200' },
  Coverage: { bg: 'bg-violet-50', text: 'text-violet-700', border: 'border-violet-200' },
  Claim:    { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200' },
}

const TYPE_SOURCE: Record<string, string> = {
  Patient:  'members',
  Coverage: 'eligibility',
  Claim:    'claims',
}

function ResourceCard({
  row, index, selected, onSelect,
}: {
  row: FhirRow; index: number; selected: boolean; onSelect: () => void
}) {
  const c = TYPE_COLORS[row.resource_type] ?? TYPE_COLORS.Patient
  const res = row.resource

  // Extract key display fields by resource type
  const summary = useMemo(() => {
    if (row.resource_type === 'Patient') {
      const names = (res.name as any)?.[0]
      return [
        names ? `${names.given?.[0] ?? ''} ${names.family ?? ''}`.trim() : res.id,
        res.birthDate as string,
        res.gender as string,
      ].filter(Boolean).join(' · ')
    }
    if (row.resource_type === 'Coverage') {
      const classes = (res.class as any)?.[0]
      return [
        classes?.name ?? (res.payor as any)?.[0]?.identifier?.value,
        res.status as string,
        (res.period as any)?.start as string,
      ].filter(Boolean).join(' · ')
    }
    if (row.resource_type === 'Claim') {
      const diag = (res.diagnosis as any)?.[0]?.diagnosisCodeableConcept?.coding?.[0]?.code
      return [
        `ICD-10: ${diag ?? '—'}`,
        `$${(res.total as any)?.value ?? '—'}`,
        res.status as string,
      ].filter(Boolean).join(' · ')
    }
    return String(res.id ?? '')
  }, [row])

  return (
    <button
      onClick={onSelect}
      className={clsx(
        'w-full text-left rounded-2xl border transition-all shadow-sm',
        selected ? `${c.border} ${c.bg}` : 'border-slate-200 bg-white hover:border-slate-300'
      )}
    >
      <div className="px-4 py-3 flex items-center gap-3">
        <div className="flex flex-col items-center justify-center w-10 h-10 rounded-xl bg-slate-100 shrink-0">
          <span className="text-xs font-bold text-slate-500">#{index}</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={clsx('px-2 py-0.5 rounded-lg text-xs font-bold border', c.bg, c.text, c.border)}>
              {row.resource_type}
            </span>
            <span className="text-xs text-slate-500 font-mono truncate">{row.resource_id?.slice(0, 18)}…</span>
          </div>
          <div className="text-xs text-slate-600 mt-1 truncate">{summary}</div>
        </div>
      </div>
    </button>
  )
}

function InputOutputPanel({ row, index }: { row: FhirRow; index: number }) {
  const res = row.resource
  const c = TYPE_COLORS[row.resource_type] ?? TYPE_COLORS.Patient

  const sourceFields = useMemo(() => {
    if (row.resource_type === 'Patient') return [
      { from: 'member_id', to: 'Patient.id', val: res.id },
      { from: 'first_name', to: 'Patient.name[0].given[0]', val: (res.name as any)?.[0]?.given?.[0] },
      { from: 'last_name', to: 'Patient.name[0].family', val: (res.name as any)?.[0]?.family },
      { from: 'date_of_birth', to: 'Patient.birthDate', val: res.birthDate },
      { from: 'gender', to: 'Patient.gender', val: res.gender },
      { from: 'address_line1', to: 'Patient.address[0].line[0]', val: (res.address as any)?.[0]?.line?.[0] },
      { from: 'city', to: 'Patient.address[0].city', val: (res.address as any)?.[0]?.city },
      { from: 'state', to: 'Patient.address[0].state', val: (res.address as any)?.[0]?.state },
      { from: 'phone', to: 'Patient.telecom[phone]', val: (res.telecom as any)?.find((t: any) => t.system === 'phone')?.value },
      { from: 'email', to: 'Patient.telecom[email]', val: (res.telecom as any)?.find((t: any) => t.system === 'email')?.value },
    ]
    if (row.resource_type === 'Coverage') return [
      { from: 'eligibility_id', to: 'Coverage.id', val: res.id },
      { from: 'member_id', to: 'Coverage.beneficiary.reference', val: (res.beneficiary as any)?.reference },
      { from: 'plan_id', to: 'Coverage.class[0].value', val: (res.class as any)?.[0]?.value },
      { from: 'plan_name', to: 'Coverage.class[0].name', val: (res.class as any)?.[0]?.name },
      { from: 'effective_date', to: 'Coverage.period.start', val: (res.period as any)?.start },
      { from: 'termination_date', to: 'Coverage.period.end', val: (res.period as any)?.end },
      { from: 'status', to: 'Coverage.status', val: res.status },
      { from: 'payer_id', to: 'Coverage.payor[0].identifier.value', val: (res.payor as any)?.[0]?.identifier?.value },
    ]
    if (row.resource_type === 'Claim') return [
      { from: 'claim_id', to: 'Claim.id', val: res.id },
      { from: 'member_id', to: 'Claim.patient.reference', val: (res.patient as any)?.reference },
      { from: 'provider_npi', to: 'Claim.provider.reference', val: (res.provider as any)?.reference },
      { from: 'icd10_primary', to: 'Claim.diagnosis[0].code', val: (res.diagnosis as any)?.[0]?.diagnosisCodeableConcept?.coding?.[0]?.code },
      { from: 'claim_amount', to: 'Claim.total.value', val: (res.total as any)?.value },
      { from: 'paid_amount', to: 'Claim.payment.amount.value', val: (res.payment as any)?.amount?.value },
      { from: 'date_of_service', to: 'Claim.billablePeriod.start', val: (res.billablePeriod as any)?.start },
      { from: 'claim_status', to: 'Claim.status', val: res.status },
    ]
    return []
  }, [row])

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className={clsx('px-5 py-4 border-b border-slate-200', c.bg)}>
        <div className="flex items-center gap-3">
          <span className={clsx('px-2.5 py-1 rounded-xl text-xs font-bold border', c.bg, c.text, c.border)}>
            Case #{index}
          </span>
          <div>
            <div className="text-slate-900 font-bold">{row.resource_type} Resource</div>
            <div className="text-xs text-slate-500 mt-0.5 font-mono">{row.resource_id}</div>
          </div>
          <div className="ml-auto text-xs text-slate-500">
            Source table: <span className="font-semibold text-slate-700">{TYPE_SOURCE[row.resource_type] ?? '—'}</span>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-5 space-y-5">
        {/* Source → FHIR mapping table */}
        <div>
          <div className="text-sm font-bold text-slate-900 mb-1">Input → Output Field Mapping</div>
          <div className="text-xs text-slate-500 mb-3">How each source column was converted to a FHIR R4 field.</div>
          <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm">
            <div className="grid grid-cols-3 gap-0 text-xs font-semibold text-slate-500 uppercase tracking-wider border-b border-slate-200 bg-slate-50 px-4 py-3">
              <div>Source Field (PostgreSQL)</div>
              <div className="text-center">→</div>
              <div>FHIR R4 Field</div>
            </div>
            {sourceFields.map((f, i) => (
              <div key={i} className={clsx('grid grid-cols-3 gap-0 px-4 py-2.5 border-b border-slate-100 last:border-0', f.val ? '' : 'opacity-40')}>
                <div className="font-mono text-slate-700 text-xs">{f.from}</div>
                <div className="text-center text-slate-400 text-xs">
                  {f.val ? (
                    <span className="inline-block px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-semibold">mapped</span>
                  ) : (
                    <span className="inline-block px-2 py-0.5 rounded-full bg-slate-100 text-slate-400 text-[10px]">empty</span>
                  )}
                </div>
                <div className="font-mono text-blue-700 text-xs truncate">{f.val != null ? String(f.val) : '—'}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Full FHIR output */}
        <div>
          <div className="text-sm font-bold text-slate-900 mb-1">Generated FHIR Resource</div>
          <div className="text-xs text-slate-500 mb-3">Complete FHIR R4 JSON payload loaded to the target.</div>
          <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm">
            <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-700">
              {row.resource_type} / {row.resource_id} · Loaded {new Date(row.loaded_at).toLocaleString()}
            </div>
            <pre className="p-4 text-xs text-slate-700 overflow-x-auto whitespace-pre-wrap">{JSON.stringify(res, null, 2)}</pre>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function FhirDataPage() {
  const [rows, setRows] = useState<FhirRow[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'All' | 'Patient' | 'Coverage' | 'Claim'>('All')
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null)

  const load = () => {
    setLoading(true)
    const q = filter === 'All' ? '' : `?resource_type=${filter}&limit=500`
    fetch(`/api/fhir/resources${q}`).then(r => r.json()).then(d => {
      setRows(Array.isArray(d) ? d : [])
      setLoading(false)
    }).catch(() => setLoading(false))
  }

  useEffect(() => { load() }, [filter])
  useEffect(() => { setSelectedIdx(null) }, [filter])

  const clearFhir = async () => { await fetch('/api/fhir/resources', { method: 'DELETE' }); load() }
  const clearHistory = async () => { await fetch('/api/runs', { method: 'DELETE' }) }

  const counts = useMemo(() => ({
    total: rows.length,
    patient: rows.filter(r => r.resource_type === 'Patient').length,
    coverage: rows.filter(r => r.resource_type === 'Coverage').length,
    claim: rows.filter(r => r.resource_type === 'Claim').length,
  }), [rows])

  const selectedRow = selectedIdx !== null ? rows[selectedIdx] : null

  return (
    <div className="h-full flex flex-col overflow-hidden bg-slate-100">
      {/* Header bar */}
      <div className="px-6 py-4 border-b border-slate-200 bg-white shrink-0">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-slate-900">FHIR Registry</h1>
            <p className="text-slate-500 text-sm mt-1">
              Every record loaded to the FHIR target is stored here. Select any case to see the input source data and the converted FHIR output side-by-side.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {(['All','Patient','Coverage','Claim'] as const).map(t => (
              <button key={t} onClick={() => setFilter(t)}
                className={clsx('px-3 py-1.5 rounded-xl text-sm border font-medium', filter === t ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-slate-300 text-slate-600 bg-white hover:bg-slate-50')}>
                {t}
              </button>
            ))}
            <button onClick={clearHistory} className="px-3 py-1.5 rounded-xl border border-slate-300 text-slate-600 hover:bg-slate-100 text-sm bg-white">Clear History</button>
            <button onClick={clearFhir} className="px-3 py-1.5 rounded-xl border border-red-200 text-red-700 hover:bg-red-50 text-sm bg-white">Clear FHIR Data</button>
          </div>
        </div>
        {/* Summary metrics */}
        <div className="grid grid-cols-4 gap-4 mt-4">
          {[
            { label: 'Total Resources', value: counts.total, color: 'text-slate-900' },
            { label: 'Patient', value: counts.patient, color: 'text-blue-700' },
            { label: 'Coverage', value: counts.coverage, color: 'text-violet-700' },
            { label: 'Claim', value: counts.claim, color: 'text-emerald-700' },
          ].map(m => (
            <div key={m.label} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 flex items-center gap-3">
              <div className={clsx('text-2xl font-bold font-mono', m.color)}>{m.value}</div>
              <div className="text-xs text-slate-500">{m.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Main content */}
      <div className="flex flex-1 min-h-0">
        {/* Left: case list */}
        <div className="w-80 shrink-0 border-r border-slate-200 bg-white overflow-y-auto p-3 space-y-2">
          {loading ? (
            <div className="text-slate-500 text-sm p-4">Loading FHIR resources...</div>
          ) : rows.length === 0 ? (
            <div className="text-slate-500 text-sm p-4">No FHIR resources yet. Run a migration first.</div>
          ) : (
            rows.map((row, idx) => (
              <ResourceCard key={idx} row={row} index={idx + 1} selected={selectedIdx === idx} onSelect={() => setSelectedIdx(idx)} />
            ))
          )}
        </div>

        {/* Right: input/output detail */}
        <div className="flex-1 min-w-0 overflow-hidden bg-white">
          {!selectedRow ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-slate-400">
              <div className="text-4xl">←</div>
              <div className="text-base font-medium">Select a case from the list</div>
              <div className="text-sm">You will see the source input and the converted FHIR output side by side.</div>
            </div>
          ) : (
            <InputOutputPanel row={selectedRow} index={(selectedIdx ?? 0) + 1} />
          )}
        </div>
      </div>
    </div>
  )
}
