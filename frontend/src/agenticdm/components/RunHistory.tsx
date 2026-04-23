import { useState } from 'react'
import { apiUrl } from '../api/client'
import clsx from 'clsx'
import { usePipelineStore } from '../store/pipelineStore'
import { MigrationRun } from '../types/pipeline'
import RunDetail from './RunDetail'

function StatusBadge({ status }: { status: string }) {
 const label = status === 'complete' ? 'Complete' : status === 'failed' ? 'Failed' : status.replace('running:', '')
 const style = status === 'complete' ? 'bg-emerald-100 text-emerald-700' : status === 'failed' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'
 return <span className={clsx('inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold', style)}>{label}</span>
}

function RunRow({ run, onClick, onDelete }: { run: MigrationRun; onClick: () => void; onDelete: (e: React.MouseEvent) => void }) {
 return (
 <div className="w-full grid grid-cols-[1.4fr_0.8fr_0.8fr_0.8fr_1fr_auto] gap-4 items-center px-5 py-4 rounded-2xl border border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50 transition-all cursor-pointer" onClick={onClick}>
 <div>
 <div className="text-slate-900 font-semibold">{run.dataset_name}</div>
 <div className="text-[10px] text-slate-500 font-mono mt-1">#{run.run_id.slice(-8).toUpperCase()}</div>
 </div>
 <div><StatusBadge status={run.status} /></div>
 <div className="text-center"><div className="font-mono font-bold text-slate-900">{run.total_source?.toLocaleString() ?? '—'}</div><div className="text-[10px] text-slate-500 mt-1">source</div></div>
 <div className="text-center"><div className="font-mono font-bold text-cyan-700">{run.total_loaded?.toLocaleString() ?? '—'}</div><div className="text-[10px] text-slate-500 mt-1">output</div></div>
 <div className="text-right"><div className="text-xs text-slate-600">{new Date(run.started_at).toLocaleString()}</div></div>
 <button onClick={onDelete} className="p-2 rounded-xl border border-red-200 text-red-500 hover:bg-red-50 text-xs transition-all" title="Delete run">
 ✕
 </button>
 </div>
 )
}

async function deleteRun(runId: string) {
 await fetch(apiUrl(`/api/runs/${runId}`), { method: 'DELETE' })
}

export default function RunHistory() {
 const runs = usePipelineStore(s => s.runs)
 const setRuns = usePipelineStore(s => s.runs)
 const [selected, setSelected] = useState<MigrationRun | null>(null)

 const handleDelete = async (e: React.MouseEvent, run: MigrationRun) => {
 e.stopPropagation()
 if (!confirm(`Delete run #${run.run_id.slice(-8).toUpperCase()} (${run.dataset_name})?`)) return
 await deleteRun(run.run_id)
 // Refresh runs from server
 const updated = await fetch(apiUrl('/api/runs')).then(r => r.json())
 usePipelineStore.setState({ runs: updated })
 }

 if (selected) return <RunDetail run={selected} onBack={() => setSelected(null)} />
 if (runs.length === 0) return <div className="flex flex-col items-center justify-center h-full gap-3 text-slate-500"><div className="text-base">No migration runs yet</div><div className="text-sm">Start a migration to create a run record.</div></div>

 return (
 <div className="flex flex-col h-full overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
 <div className="px-6 py-5 border-b border-slate-200 shrink-0 bg-slate-50 flex items-center justify-between">
 <div>
 <h2 className="text-slate-900 font-bold text-xl">Run History</h2>
 <p className="text-slate-500 text-sm mt-1">Open any run to review stage-by-stage processing.</p>
 </div>
 </div>
 <div className="flex flex-col gap-3 p-4 overflow-y-auto bg-slate-50/50">
 {runs.map(run => <RunRow key={run.run_id} run={run} onClick={() => setSelected(run)} onDelete={(e) => handleDelete(e, run)} />)}
 </div>
 </div>
 )
}
