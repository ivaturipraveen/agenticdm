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

function Metric({ label, value, tone = 'text-slate-900' }: { label: string; value: string | number; tone?: string }) {
 return <div className="rounded-2xl border border-slate-200 bg-white p-4 text-center shadow-sm"><div className={clsx('text-2xl font-bold font-mono', tone)}>{value}</div><div className="text-xs text-slate-500 mt-1">{label}</div></div>
}

export default function FhirDataPage() {
 const [rows, setRows] = useState<FhirRow[]>([])
 const [loading, setLoading] = useState(true)
 const [filter, setFilter] = useState<'All' | 'Patient' | 'Coverage' | 'Claim'>('All')
 const [selected, setSelected] = useState<FhirRow | null>(null)

 const load = () => {
 setLoading(true)
 const q = filter === 'All' ? '' : `?resource_type=${filter}`
 fetch(`/api/fhir/resources${q}`).then(r => r.json()).then(d => { setRows(Array.isArray(d) ? d : []); setLoading(false) }).catch(() => setLoading(false))
 }

 useEffect(() => { load() }, [filter])

 const clearFhir = async () => {
 await fetch('/api/fhir/resources', { method: 'DELETE' })
 setSelected(null)
 load()
 }

 const clearHistory = async () => {
 await fetch('/api/runs', { method: 'DELETE' })
 }

 const grouped = useMemo(() => {
 const map = new Map<string, FhirRow[]>()
 for (const row of rows) {
 const key = `${row.dataset_id}::${row.run_id}`
 if (!map.has(key)) map.set(key, [])
 map.get(key)!.push(row)
 }
 return Array.from(map.entries())
 }, [rows])

 const counts = useMemo(() => ({
 total: rows.length,
 patient: rows.filter(r => r.resource_type === 'Patient').length,
 coverage: rows.filter(r => r.resource_type === 'Coverage').length,
 claim: rows.filter(r => r.resource_type === 'Claim').length,
 }), [rows])

 return (
 <div className="h-full overflow-y-auto p-4 bg-slate-100">
 <div className="rounded-3xl border border-slate-200 bg-white overflow-hidden shadow-sm">
 <div className="px-6 py-5 border-b border-slate-200 bg-slate-50 flex items-center justify-between gap-4">
 <div>
 <div className="text-slate-900 font-bold text-xl">Loaded FHIR Data</div>
 <div className="text-slate-500 text-sm mt-1">Resources written during load are stored here for review, grouping, and deletion.</div>
 </div>
 <div className="flex items-center gap-2">
 {(['All','Patient','Coverage','Claim'] as const).map(t => <button key={t} onClick={() => setFilter(t)} className={clsx('px-3 py-1.5 rounded-xl text-sm border', filter === t ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-slate-300 text-slate-600 bg-white')}>{t}</button>)}
 <button onClick={clearHistory} className="px-3 py-1.5 rounded-xl border border-slate-300 text-slate-700 hover:bg-slate-100 text-sm bg-white">Delete History</button>
 <button onClick={clearFhir} className="px-3 py-1.5 rounded-xl border border-red-200 text-red-700 hover:bg-red-50 text-sm bg-white">Delete FHIR Data</button>
 </div>
 </div>
 <div className="p-5 space-y-5 bg-slate-50/50">
 <div className="grid grid-cols-4 gap-4">
 <Metric label="Total Resources" value={counts.total} />
 <Metric label="Patients" value={counts.patient} tone="text-blue-700" />
 <Metric label="Coverage" value={counts.coverage} tone="text-violet-700" />
 <Metric label="Claims" value={counts.claim} tone="text-emerald-700" />
 </div>
 {loading ? <div className="text-slate-500">Loading FHIR resources...</div> : rows.length === 0 ? <div className="text-slate-500">No loaded FHIR resources yet.</div> : <div className="grid grid-cols-[1.2fr_0.8fr] gap-5">
 <div className="space-y-4">
 {grouped.map(([key, items]) => (
 <div key={key} className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm">
 <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
 <div>
 <div className="text-slate-900 font-semibold">Dataset: {items[0].dataset_id}</div>
 <div className="text-xs text-slate-500 mt-1">Run #{items[0].run_id.slice(-8).toUpperCase()} • {items.length} resources</div>
 </div>
 <div className="text-xs text-slate-500">{new Date(items[0].loaded_at).toLocaleString()}</div>
 </div>
 <div className="overflow-x-auto">
 <table className="w-full text-xs">
 <thead><tr className="bg-slate-50"><th className="text-left px-3 py-2 text-slate-500">Type</th><th className="text-left px-3 py-2 text-slate-500">Resource ID</th><th className="text-left px-3 py-2 text-slate-500">Loaded</th><th className="text-left px-3 py-2 text-slate-500">Action</th></tr></thead>
 <tbody>{items.map((row, idx) => <tr key={idx} className={idx % 2 === 0 ? 'bg-slate-50/60' : ''}><td className="px-3 py-2 text-slate-900 font-medium">{row.resource_type}</td><td className="px-3 py-2 text-slate-600 font-mono max-w-[220px] truncate">{row.resource_id || 'generated'}</td><td className="px-3 py-2 text-slate-500">{new Date(row.loaded_at).toLocaleString()}</td><td className="px-3 py-2"><button onClick={() => setSelected(row)} className="px-2.5 py-1 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-100 bg-white">View</button></td></tr>)}</tbody>
 </table>
 </div>
 </div>
 ))}
 </div>
 <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden min-h-[420px] shadow-sm">
 <div className="px-4 py-3 border-b border-slate-200 text-sm font-semibold text-slate-900 bg-slate-50">FHIR Resource Detail</div>
 {!selected ? <div className="p-5 text-slate-500">Select a resource to inspect its full FHIR payload.</div> : <><div className="px-4 py-3 border-b border-slate-200 bg-slate-50"><div className="text-slate-900 font-semibold">{selected.resource_type} / {selected.resource_id || 'generated'}</div><div className="text-xs text-slate-500 mt-1">Dataset: {selected.dataset_id} • Run #{selected.run_id.slice(-8).toUpperCase()}</div></div><pre className="p-4 text-xs text-slate-700 overflow-x-auto whitespace-pre-wrap">{JSON.stringify(selected.resource, null, 2)}</pre></>}
 </div>
 </div>}
 </div>
 </div>
 </div>
 )
}
