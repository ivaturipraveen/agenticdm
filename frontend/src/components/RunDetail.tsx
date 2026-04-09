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

const STAGE_IO: Record<string, { inputLabel: string; inputDesc: string; outputLabel: string; outputDesc: string }> = {
 discovery: {
 inputLabel: 'Source Schema', inputDesc: 'Raw PostgreSQL table names, column names, data types, and sample rows.',
 outputLabel: 'Mapping Contract', outputDesc: 'Inferred FHIR resource types and field mappings with confidence scores passed to the Transformation Agent.',
 },
 transformation: {
 inputLabel: 'Mapping Contract + Source Rows', inputDesc: 'The confirmed field mappings from Discovery and the actual source data rows.',
 outputLabel: 'FHIR Resources', outputDesc: 'Converted FHIR-ready records ready for approval and load. Anomalies are quarantined.',
 },
 orchestration: {
 inputLabel: 'Validated FHIR Resources', inputDesc: 'FHIR-ready resources plus approval decision from human operator.',
 outputLabel: 'Loaded FHIR Data', outputDesc: 'Resources posted to the FHIR target endpoint and stored locally in the FHIR Registry.',
 },
 qa: {
 inputLabel: 'Source Counts + Loaded Counts', inputDesc: 'Original record volumes from the source database and final FHIR load totals.',
 outputLabel: 'QA Report', outputDesc: 'Match rate, checksum signals, anomaly count, business rule violations, and compliance score.',
 },
}

function StepView({ output, logs }: { output?: AgentOutput; logs: RunLog[] }) {
 if (!output) return <div className="p-5 text-slate-500">No output recorded for this step.</div>
 const meta = STEP_META[output.agent] || STEP_META.discovery
 const io = STAGE_IO[output.agent]
 const reasoning = logs.filter(l => l.log_type === 'reasoning')
 return (
 <div className="flex-1 overflow-y-auto p-5 space-y-5 bg-slate-50/50">
 {/* Agent header */}
 <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
 <div className="text-slate-900 font-bold text-2xl">{meta.title}</div>
 <div className="text-slate-600 text-sm mt-2 leading-relaxed">{meta.explanation}</div>
 </div>
 {/* Input/Output boxes */}
 {io && (
 <div className="grid grid-cols-2 gap-4">
 <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
 <div className="flex items-center gap-2 mb-3">
 <div className="w-7 h-7 rounded-xl bg-slate-100 flex items-center justify-center text-xs font-bold text-slate-600">IN</div>
 <div className="text-sm font-bold text-slate-900">{io.inputLabel}</div>
 </div>
 <div className="text-sm text-slate-600 leading-relaxed">{io.inputDesc}</div>
 <div className="mt-3 text-2xl font-bold font-mono text-slate-900">{(output.records_in ?? 0).toLocaleString()}<span className="text-sm font-normal text-slate-500 ml-2">records</span></div>
 </div>
 <div className="rounded-2xl border border-blue-200 bg-blue-50 p-5 shadow-sm">
 <div className="flex items-center gap-2 mb-3">
 <div className="w-7 h-7 rounded-xl bg-blue-100 flex items-center justify-center text-xs font-bold text-blue-700">OUT</div>
 <div className="text-sm font-bold text-slate-900">{io.outputLabel}</div>
 </div>
 <div className="text-sm text-slate-600 leading-relaxed">{io.outputDesc}</div>
 <div className="mt-3 text-2xl font-bold font-mono text-blue-700">{(output.records_out ?? 0).toLocaleString()}<span className="text-sm font-normal text-slate-500 ml-2">records</span></div>
 </div>
 </div>
 )}
 {/* Anomalies if any */}
 {(output.anomalies ?? 0) > 0 && (
 <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 shadow-sm">
 <div className="text-sm font-bold text-amber-800">{output.anomalies} anomalies quarantined</div>
 <div className="text-xs text-amber-700 mt-1">These records had data quality issues and were not passed to the next stage.</div>
 </div>
 )}
 {/* Output summary - collapsible */}
 <JsonCard title="Stage Output Data" data={output.output} />
 {reasoning.length > 0 && <JsonCard title="Agent Reasoning Log" data={reasoning.map(r => ({ step: r.action, detail: r.details, time: new Date(r.timestamp).toLocaleTimeString() }))} />}
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
