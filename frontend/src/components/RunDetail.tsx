import { useEffect, useState } from 'react'
import clsx from 'clsx'
import { MigrationRun } from '../types/pipeline'
import DataView from './DataView'

interface RunLog {
 timestamp: string; agent: string; action: string; status: string
 records_affected: number; details: string; log_type: string
}

interface AgentOutput {
 agent: string; agent_num: number; status: string
 records_in: number; records_out: number; anomalies: number
 summary: string; output: Record<string, unknown>; completed_at: string
}

const STEP_META: Record<string, { title: string; explanation: string; why: string }> = {
 discovery: {
 title: 'Discovery Agent',
 explanation: 'Reads source tables, analyzes columns, and decides how they should map to FHIR resources.',
 why: 'This step creates the mapping contract used by all later stages.',
 },
 transformation: {
 title: 'Transformation Agent',
 explanation: 'Uses the mapping contract to convert source rows into FHIR-ready records.',
 why: 'This is where the relational source becomes structured healthcare resources.',
 },
 orchestration: {
 title: 'Orchestration Agent',
 explanation: 'Coordinates validation, approval, and final loading into the FHIR destination.',
 why: 'This step controls progression and makes sure loading happens only after review.',
 },
 qa: {
 title: 'QA / Reconciliation Agent',
 explanation: 'Compares the source volume and the final output to verify migration integrity.',
 why: 'This confirms that what started in the source made it through correctly.',
 },
}

function Metric({ label, value, color }: { label: string; value: string; color: string }) {
 return <div className="bg-white border border-slate-200 rounded-2xl p-4 text-center shadow-sm"><div className={clsx('text-3xl font-bold font-mono', color)}>{value}</div><div className="text-sm text-slate-500 mt-1">{label}</div></div>
}

function JsonCard({ title, data }: { title: string; data: unknown }) {
 return <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm"><div className="px-4 py-3 border-b border-slate-200 text-sm font-semibold text-slate-900 bg-slate-50">{title}</div><pre className="p-4 text-xs text-slate-700 overflow-x-auto whitespace-pre-wrap">{JSON.stringify(data, null, 2)}</pre></div>
}

function FinalResultsView({ runId, datasetName }: { runId: string; datasetName: string }) {
 return <DataView runId={runId} datasetName={datasetName} />
}

function StepView({ output, logs }: { output?: AgentOutput; logs: RunLog[] }) {
 if (!output) return <div className="p-5 text-slate-500">No output recorded for this step.</div>
 const meta = STEP_META[output.agent] || STEP_META.discovery
 const reasoning = logs.filter(l => l.log_type === 'reasoning')
 return (
 <div className="flex-1 overflow-y-auto p-5 space-y-6 bg-slate-50/50">
 <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
 <div className="text-slate-900 font-bold text-2xl">{meta.title}</div>
 <div className="text-slate-600 text-sm mt-2 leading-relaxed">{meta.explanation}</div>
 <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 mt-4"><div className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold mb-2">Why this stage exists</div><div className="text-sm text-slate-700">{meta.why}</div></div>
 </div>
 <div className="grid grid-cols-3 gap-4">
 <Metric label="Input Count" value={String(output.records_in ?? 0)} color="text-slate-700" />
 <Metric label="Output Count" value={String(output.records_out ?? 0)} color="text-blue-700" />
 <Metric label="Anomalies" value={String(output.anomalies ?? 0)} color="text-amber-700" />
 </div>
 <JsonCard title="Stage Output Summary" data={output.output} />
 <JsonCard title="Stage Reasoning" data={reasoning} />
 </div>
 )
}

export default function RunDetail({ run, onBack }: { run: MigrationRun; onBack: () => void }) {
 const [logs, setLogs] = useState<RunLog[]>([])
 const [agentOutputs, setAgentOutputs] = useState<AgentOutput[]>([])
 const [active, setActive] = useState<string>('discovery')
 const [view, setView] = useState<'steps' | 'final'>('steps')
 const [loading, setLoading] = useState(true)

 useEffect(() => {
 setLoading(true)
 Promise.all([
 fetch(`/api/runs/${run.run_id}/logs`).then(r => r.json()),
 fetch(`/api/runs/${run.run_id}/agents`).then(r => r.json()),
 ]).then(([l, a]) => {
 setLogs(Array.isArray(l) ? l : [])
 setAgentOutputs(Array.isArray(a) ? a : [])
 setLoading(false)
 })
 }, [run.run_id])

 const activeOutput = agentOutputs.find(a => a.agent === active)
 const activeLogs = logs.filter(l => l.agent === active || (active === 'orchestration' && l.agent === 'system'))

 return (
 <div className="flex flex-col h-full bg-slate-100">
 <div className="flex items-center gap-4 px-5 py-4 border-b border-slate-200 shrink-0 bg-white">
 <button onClick={onBack} className="px-3 py-1.5 rounded-xl border border-slate-300 text-slate-700 hover:bg-slate-100 text-sm transition-colors bg-white">Back</button>
 <div className="flex-1">
 <div className="text-slate-900 font-bold text-lg">{run.dataset_name}</div>
 <div className="text-slate-500 text-xs mt-1">#{run.run_id.slice(-8).toUpperCase()}</div>
 </div>
 <div className="flex items-center gap-2">
 <button onClick={() => setView('steps')} className={clsx('px-3 py-1.5 rounded-xl text-sm border', view === 'steps' ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-slate-300 text-slate-600 bg-white')}>Step View</button>
 <button onClick={() => setView('final')} className={clsx('px-3 py-1.5 rounded-xl text-sm border', view === 'final' ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-slate-300 text-slate-600 bg-white')}>Final Results</button>
 </div>
 </div>

 {loading ? <div className="flex items-center justify-center flex-1 text-slate-500">Loading run data...</div> : (
 <div className="flex flex-1 min-h-0">
 <div className="w-80 shrink-0 border-r border-slate-200 bg-white p-4 overflow-y-auto space-y-4">
 <div className="grid grid-cols-2 gap-3">
 <Metric label="Source" value={(run.total_source ?? 0).toLocaleString()} color="text-slate-700" />
 <Metric label="Output" value={(run.total_loaded ?? 0).toLocaleString()} color="text-cyan-700" />
 <Metric label="Anomalies" value={String(run.anomaly_count ?? 0)} color="text-amber-700" />
 <Metric label="Match" value={`${run.match_pct?.toFixed(1) ?? '0'}%`} color="text-emerald-700" />
 </div>
 {view === 'steps' && <div><div className="text-xs uppercase tracking-wider text-slate-500 font-semibold mb-2">Agents</div><div className="space-y-2">{agentOutputs.filter(a => a.agent !== 'monitor').map(step => <button key={step.agent} onClick={() => setActive(step.agent)} className={clsx('w-full text-left p-4 rounded-2xl border transition-all', active === step.agent ? 'border-blue-200 bg-blue-50' : 'border-slate-200 bg-white hover:border-slate-300')}><div className="text-slate-900 font-semibold text-sm">{STEP_META[step.agent]?.title || step.agent}</div><div className="text-slate-500 text-xs mt-1">{STEP_META[step.agent]?.explanation}</div></button>)}</div></div>}
 </div>
 <div className="flex-1 min-w-0 overflow-hidden">{view === 'final' ? <FinalResultsView runId={run.run_id} datasetName={run.dataset_name} /> : <StepView output={activeOutput} logs={activeLogs} />}</div>
 </div>
 )}
 </div>
 )
}
