import { useEffect, useState } from 'react'
import clsx from 'clsx'
import { usePipelineStore } from '../store/pipelineStore'
import DatasetSelector from './DatasetSelector'

interface ColDef { name: string; type: string }
interface TableData { count: number; columns: ColDef[]; sample: Record<string, unknown>[] }
interface DbPreview { members: TableData; eligibility: TableData; claims: TableData }

const FHIR_TARGET: Record<string, string> = {
 members: 'Patient', eligibility: 'Coverage', claims: 'Claim',
}
const TABLE_COLOR: Record<string, { border: string; badge: string; head: string; dot: string }> = {
 members: { border: 'border-blue-500/30', badge: 'bg-blue-500/10 text-blue-400 border-blue-500/30', head: 'bg-blue-500/5', dot: 'bg-blue-400' },
 eligibility: { border: 'border-violet-500/30', badge: 'bg-violet-500/10 text-violet-400 border-violet-500/30', head: 'bg-violet-500/5', dot: 'bg-violet-400' },
 claims: { border: 'border-emerald-500/30', badge: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30', head: 'bg-emerald-500/5', dot: 'bg-emerald-400' },
}

function TableCard({ name, data }: { name: string; data: TableData }) {
 const c = TABLE_COLOR[name] ?? TABLE_COLOR.claims
 const [show, setShow] = useState(false)
 return (
 <div className={clsx('rounded-xl border bg-[#0D1424] overflow-hidden', c.border)}>
 <div className={clsx('px-4 py-3 flex items-center justify-between', c.head)}>
 <div className="flex items-center gap-2.5">
 <div className={clsx('w-2 h-2 rounded-full', c.dot)} />
 <span className="font-bold text-white capitalize">{name}</span>
 <span className={clsx('px-2 py-0.5 rounded-full border text-[11px] font-semibold', c.badge)}> FHIR {FHIR_TARGET[name]}</span>
 </div>
 <div className="flex items-center gap-3">
 <span className="text-slate-400 text-sm font-mono font-bold">{data.count.toLocaleString()} rows</span>
 <button onClick={() => setShow(v => !v)} className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg text-xs text-slate-400 transition-all">
 {show ? 'Hide' : 'Preview data'}
 </button>
 </div>
 </div>
 <div className="px-4 py-3 border-t border-slate-800/60">
 <div className="flex flex-wrap gap-1.5">
 {data.columns.map(col => (
 <span key={col.name} className="inline-flex items-center gap-1.5 px-2 py-1 bg-slate-900 border border-slate-800 rounded-md text-xs">
 <span className="text-slate-300 font-mono">{col.name}</span>
 <span className="text-[10px] text-slate-600 font-mono">{col.type.replace('character varying','varchar').replace('timestamp without time zone','ts')}</span>
 </span>
 ))}
 </div>
 </div>
 {show && (
 <div className="border-t border-slate-800 overflow-x-auto">
 <table className="w-full text-[11px]">
 <thead>
 <tr className="bg-slate-900/60">
 {data.columns.slice(0,6).map(col => (
 <th key={col.name} className="text-left text-slate-500 font-semibold px-3 py-2 whitespace-nowrap font-mono border-r border-slate-800 last:border-0">{col.name}</th>
 ))}
 {data.columns.length > 6 && <th className="text-slate-700 px-3 py-2">+{data.columns.length-6}</th>}
 </tr>
 </thead>
 <tbody>
 {data.sample.map((row, i) => (
 <tr key={i} className={i%2===0?'bg-slate-900/20':''}>
 {data.columns.slice(0,6).map(col => (
 <td key={col.name} className="px-3 py-1.5 text-slate-400 font-mono border-r border-slate-800/50 last:border-0 whitespace-nowrap max-w-[140px] truncate">
 {row[col.name]==null?<span className="text-slate-700">null</span>:String(row[col.name]).slice(0,28)}
 </td>
 ))}
 </tr>
 ))}
 </tbody>
 </table>
 </div>
 )}
 </div>
 )
}

export default function PreMigrationView() {
 const [db, setDb] = useState<DbPreview | null>(null)
 const [loading, setLoading] = useState(false)
 const selectedDatasetId = usePipelineStore(s => s.selectedDatasetId)
 const setSelectedDataset = usePipelineStore(s => s.setSelectedDataset)
 const startFn = usePipelineStore(s => s.startPipeline)

 useEffect(() => {
 setLoading(true)
 setDb(null)
 fetch(`/api/datasets/${selectedDatasetId}/preview`)
 .then(r => r.json())
 .then(d => { setDb(d); setLoading(false) })
 .catch(() => setLoading(false))
 }, [selectedDatasetId])

 const totalRows = db ? Object.values(db).reduce((s, t) => s + t.count, 0) : 0

 return (
 <div className="h-full overflow-y-auto">
 <div className="max-w-5xl mx-auto px-6 py-8 space-y-8">

 {/* Hero */}
 <div className="text-center space-y-2">
 <div className="inline-flex items-center gap-2 px-3 py-1 bg-blue-500/10 border border-blue-500/20 rounded-full text-blue-400 text-xs font-semibold uppercase tracking-wider">
 Healthcare Data Migration Platform
 </div>
 <h1 className="text-3xl font-bold text-white">Legacy PostgreSQL HAPI FHIR R4</h1>
 <p className="text-slate-400">Select a dataset, review the data, then run the 5-agent migration pipeline</p>
 </div>

 {/* Step 1 — Select dataset */}
 <div>
 <div className="flex items-center gap-3 mb-4">
 <div className="w-7 h-7 rounded-lg bg-blue-500 flex items-center justify-center text-white font-bold text-sm shrink-0">1</div>
 <div>
 <div className="text-white font-bold">Choose Dataset</div>
 <div className="text-slate-500 text-xs">Select which synthetic data cohort to migrate</div>
 </div>
 </div>
 <DatasetSelector selected={selectedDatasetId} onSelect={setSelectedDataset} />
 </div>

 {/* Step 2 — Review data */}
 <div>
 <div className="flex items-center gap-3 mb-4">
 <div className="w-7 h-7 rounded-lg bg-blue-500 flex items-center justify-center text-white font-bold text-sm shrink-0">2</div>
 <div className="flex-1">
 <div className="text-white font-bold">Review Source Data</div>
 <div className="text-slate-500 text-xs">Verify the records before migration starts</div>
 </div>
 {!loading && db && (
 <div className="text-right">
 <div className="text-xl font-bold text-white">{totalRows.toLocaleString()}</div>
 <div className="text-xs text-slate-500">total records</div>
 </div>
 )}
 </div>

 {loading && (
 <div className="flex items-center justify-center py-12 gap-2 text-slate-500">
 <div className="w-4 h-4 border-2 border-slate-700 border-t-blue-500 rounded-full animate-spin" />
 Loading dataset...
 </div>
 )}
 {db && !loading && (
 <div className="space-y-3">
 {Object.entries(db).map(([name, data]) => (
 <TableCard key={name} name={name} data={data} />
 ))}
 </div>
 )}
 </div>

 {/* Step 3 — Pipeline preview */}
 <div>
 <div className="flex items-center gap-3 mb-4">
 <div className="w-7 h-7 rounded-lg bg-blue-500 flex items-center justify-center text-white font-bold text-sm shrink-0">3</div>
 <div>
 <div className="text-white font-bold">Migration Pipeline</div>
 <div className="text-slate-500 text-xs">5 agents will run in sequence — each step is logged in real time</div>
 </div>
 </div>
 <div className="grid grid-cols-1 gap-2">
 {[
 { n:1, icon:'', title:'Discovery Agent', desc:'Connects to Postgres, scans all 3 tables, auto-generates FHIR R4 field mapping', color:'text-blue-400' },
 { n:2, icon:'', title:'Transformation Agent', desc:'Normalizes ICD-10 codes, fixes member IDs to UUID, standardizes dates, handles nulls', color:'text-violet-400' },
 { n:3, icon:'', title:'Orchestration Agent', desc:'Validates data, presents approval gate, loads FHIR bundles in batches of 100', color:'text-cyan-400' },
 { n:4, icon:'', title:'QA / Reconciliation', desc:'Compares source vs target counts, runs checksums, validates business rules', color:'text-emerald-400'},
 { n:5, icon:'', title:'Integration Monitor', desc:'Watches schema for drift every 30 seconds — halts pipeline if column changes detected', color:'text-orange-400'},
 ].map(s => (
 <div key={s.n} className="flex items-center gap-4 p-3.5 bg-[#0D1424] border border-slate-800 rounded-xl">
 <div className="w-8 h-8 rounded-lg bg-slate-900 border border-slate-700 flex items-center justify-center text-base shrink-0">{s.icon}</div>
 <div className="flex-1 min-w-0">
 <span className={clsx('font-semibold text-sm', s.color)}>Agent {s.n} — {s.title}</span>
 <div className="text-slate-500 text-xs mt-0.5">{s.desc}</div>
 </div>
 </div>
 ))}
 <div className="flex items-center gap-4 p-3.5 bg-amber-500/5 border border-amber-500/20 rounded-xl">
 <div className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-base shrink-0">⏸</div>
 <div>
 <span className="font-semibold text-sm text-amber-400">Human Approval Gate</span>
 <div className="text-slate-500 text-xs mt-0.5">Pipeline pauses before FHIR load — you review stats and explicitly approve or halt</div>
 </div>
 </div>
 </div>
 </div>

 {/* Start button */}
 <div className="flex flex-col items-center gap-3 pb-8">
 <button
 onClick={startFn}
 disabled={loading || !db}
 className="px-12 py-4 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-500 hover:to-blue-600 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold rounded-2xl text-lg shadow-xl shadow-blue-500/20 transition-all hover:scale-105 active:scale-95"
 >
 Start Migration
 </button>
 <p className="text-slate-600 text-xs">
 {totalRows.toLocaleString()} records · 5 agents · compliance metrics after completion
 </p>
 </div>

 </div>
 </div>
 )
}
