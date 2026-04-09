import { useEffect, useState } from 'react'
import { usePipelineStore } from '../store/pipelineStore'
import DatasetSelector from './DatasetSelector'

interface ColDef { name: string; type: string }
interface TableData { count: number; columns: ColDef[]; sample: Record<string, unknown>[] }
interface DbPreview { [key: string]: TableData | undefined }

const FHIR_TARGET: Record<string, string> = { members: 'Patient', eligibility: 'Coverage', claims: 'Claim' }

function TableCard({ name, data }: { name: string; data: TableData }) {
 const [show, setShow] = useState(false)
 return (
 <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm">
 <div className="px-5 py-4 flex items-center justify-between bg-slate-50">
 <div>
 <div className="font-semibold text-slate-900 capitalize text-base">{name}</div>
 <div className="text-xs text-slate-500 mt-1">Target resource: {FHIR_TARGET[name] || 'Inferred at runtime'}</div>
 </div>
 <div className="flex items-center gap-3">
 <span className="text-slate-700 text-sm font-mono">{data.count.toLocaleString()} rows</span>
 <button onClick={() => setShow(v => !v)} className="px-3 py-1.5 bg-white hover:bg-slate-100 border border-slate-300 rounded-xl text-xs text-slate-700 transition-all">{show ? 'Hide sample' : 'Show sample'}</button>
 </div>
 </div>
 <div className="px-5 py-4 border-t border-slate-200 flex flex-wrap gap-2">
 {data.columns.map(col => <span key={col.name} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs"><span className="text-slate-700 font-mono">{col.name}</span><span className="text-[10px] text-slate-500 font-mono">{col.type.replace('character varying','varchar')}</span></span>)}
 </div>
 {show && <div className="border-t border-slate-200 overflow-x-auto"><table className="w-full text-[11px]"><thead><tr className="bg-slate-50">{data.columns.slice(0,6).map(col => <th key={col.name} className="text-left text-slate-500 font-semibold px-4 py-3 whitespace-nowrap font-mono">{col.name}</th>)}</tr></thead><tbody>{data.sample.map((row, i) => <tr key={i} className={i%2===0?'bg-slate-50/60':''}>{data.columns.slice(0,6).map(col => <td key={col.name} className="px-4 py-2 text-slate-700 font-mono whitespace-nowrap max-w-[160px] truncate">{row[col.name]==null?<span className="text-slate-400">null</span>:String(row[col.name]).slice(0,28)}</td>)}</tr>)}</tbody></table></div>}
 </div>
 )
}

function StageCard({ title, subtitle, index }: { title: string; subtitle: string; index: number }) {
 return (
 <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
 <div className="flex items-start gap-4">
 <div className="w-10 h-10 rounded-2xl bg-blue-600 text-white font-bold flex items-center justify-center shrink-0">{index}</div>
 <div>
 <div className="text-slate-900 font-semibold">{title}</div>
 <div className="text-slate-500 text-sm mt-1 leading-relaxed">{subtitle}</div>
 </div>
 </div>
 </div>
 )
}

export default function PreMigrationView() {
 const [db, setDb] = useState<DbPreview | null>(null)
 const [loading, setLoading] = useState(false)
 const selectedDatasetId = usePipelineStore(s => s.selectedDatasetId)
 const setSelectedDataset = usePipelineStore(s => s.setSelectedDataset)
 const startFn = usePipelineStore(s => s.startPipeline)
 const stage = usePipelineStore(s => s.stage)
 const runId = usePipelineStore(s => s.runId)

 useEffect(() => {
 setLoading(true)
 setDb(null)
 fetch(`/api/datasets/${selectedDatasetId}/preview`).then(r => r.json()).then(d => { setDb(d); setLoading(false) }).catch(() => setLoading(false))
 }, [selectedDatasetId])

 const totalRows = db ? Object.values(db).reduce((s, t) => s + (t?.count || 0), 0) : 0
 const alreadyRunning = !['IDLE', 'COMPLETE', 'HALTED'].includes(stage)

 return (
 <div className="h-full overflow-y-auto">
 <div className="max-w-7xl mx-auto px-6 py-8 space-y-8">
 <div className="space-y-3">
 <h1 className="text-4xl font-bold text-slate-900 tracking-tight">Healthcare Data Migration</h1>
 <p className="text-slate-600 max-w-3xl leading-relaxed">Choose a dataset, inspect the source tables, and start the pipeline. Each agent will then show how the data moves from relational source records to FHIR output.</p>
 </div>

 <div className="grid grid-cols-[1.05fr_0.95fr] gap-6 items-start">
 <div className="rounded-3xl border border-slate-200 bg-white p-6 space-y-6 shadow-sm">
 <div>
 <div className="text-slate-900 font-bold text-xl">Dataset Selection</div>
 <div className="text-slate-500 text-sm mt-1">Select the source dataset and review what will be processed.</div>
 </div>
 <DatasetSelector selected={selectedDatasetId} onSelect={setSelectedDataset} />
 <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5 flex items-center justify-between">
 <div>
 <div className="text-slate-900 font-semibold">Selected dataset</div>
 <div className="text-slate-500 text-sm mt-1"><span className="font-mono text-slate-700">{selectedDatasetId}</span> • {totalRows.toLocaleString()} source rows</div>
 </div>
 <button onClick={startFn} disabled={loading || !db || alreadyRunning} className="px-8 py-3.5 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-500 hover:to-blue-600 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold rounded-2xl text-sm shadow-sm transition-all">{alreadyRunning ? 'Run already in progress' : 'Start Pipeline'}</button>
 </div>
 {alreadyRunning && <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-700">A run is already active. A second run will not be accepted until the current one finishes. Current run: <span className="font-mono">{runId || 'active'}</span></div>}
 </div>

 <div className="space-y-4">
 <StageCard index={1} title="Discovery Agent" subtitle="Scans the source schema, identifies likely FHIR resources, and proposes mappings." />
 <StageCard index={2} title="Transformation Agent" subtitle="Converts source rows into FHIR-ready records and highlights anything uncertain." />
 <StageCard index={3} title="Orchestration Agent" subtitle="Coordinates confirmation, handles batch progression, and loads the final resources." />
 <StageCard index={4} title="QA / Reconciliation Agent" subtitle="Checks whether the output matches the source counts and confirms migration integrity." />
 <StageCard index={5} title="Integration Monitor Agent" subtitle="Watches for schema drift during execution to protect the run." />
 </div>
 </div>

 <div className="rounded-3xl border border-slate-200 bg-white p-6 space-y-4 shadow-sm">
 <div>
 <div className="text-slate-900 font-bold text-xl">Source Data Review</div>
 <div className="text-slate-500 text-sm mt-1">Review the source tables before starting the run.</div>
 </div>
 {loading && <div className="flex items-center justify-center py-12 gap-2 text-slate-500"><div className="w-4 h-4 border-2 border-slate-300 border-t-blue-500 rounded-full animate-spin" />Loading dataset...</div>}
 {db && !loading && <div className="space-y-4">{Object.entries(db).map(([name, data]) => data ? <TableCard key={name} name={name} data={data} /> : null)}</div>}
 </div>
 </div>
 </div>
 )
}
