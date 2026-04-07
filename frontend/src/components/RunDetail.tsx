import { useEffect, useState } from 'react'
import clsx from 'clsx'
import { MigrationRun } from '../types/pipeline'
import DataView from './DataView'

interface RunLog {
 timestamp: string; agent: string; action: string; status: string
 records_affected: number; details: string; log_type: string
 emoji?: string; step_title?: string
}

interface AgentOutput {
 agent: string; agent_num: number; status: string
 records_in: number; records_out: number; anomalies: number
 summary: string; output: Record<string, unknown>; completed_at: string
}

const AGENT_DEFS = [
 { id: 'discovery', num: 1, title: 'Discovery Agent', subtitle: 'Dynamic schema and mapping inference', color: 'blue' },
 { id: 'transformation', num: 2, title: 'Transformation Agent', subtitle: 'FHIR generation and validation', color: 'violet' },
 { id: 'orchestration', num: 3, title: 'Orchestration Agent', subtitle: 'Loading and final bundle orchestration', color: 'cyan' },
 { id: 'qa', num: 4, title: 'QA / Reconciliation', subtitle: 'Counts and integrity verification', color: 'emerald' },
 { id: 'monitor', num: 5, title: 'Integration Monitor', subtitle: 'Schema drift watcher', color: 'orange' },
]

const COLOR: Record<string, Record<string, string>> = {
 blue: { border: 'border-blue-500/40', bg: 'bg-blue-500/10', text: 'text-blue-400' },
 violet: { border: 'border-violet-500/40', bg: 'bg-violet-500/10', text: 'text-violet-400' },
 cyan: { border: 'border-cyan-500/40', bg: 'bg-cyan-500/10', text: 'text-cyan-400' },
 emerald: { border: 'border-emerald-500/40', bg: 'bg-emerald-500/10', text: 'text-emerald-400' },
 orange: { border: 'border-orange-500/40', bg: 'bg-orange-500/10', text: 'text-orange-400' },
}

function JsonPanel({ title, data }: { title: string; data: unknown }) {
 return <div className="rounded-lg border border-slate-800 overflow-hidden bg-slate-900/30"><div className="px-4 py-3 border-b border-slate-800 text-sm font-semibold text-white">{title}</div><pre className="p-4 text-xs text-slate-300 overflow-x-auto whitespace-pre-wrap">{JSON.stringify(data, null, 2)}</pre></div>
}

function Sidebar({ active, onSelect, showSummary, onSummary, showDataView, onDataView }:
 { active: string; onSelect: (id: string) => void; showSummary: boolean; onSummary: () => void; showDataView: boolean; onDataView: () => void }) {
 return (
 <div className="w-56 shrink-0 flex flex-col gap-1 pr-2 border-r border-slate-800 overflow-y-auto">
 <div className="text-[10px] text-slate-600 uppercase tracking-wider font-semibold px-2 pb-2">Agents</div>
 {AGENT_DEFS.map(a => {
 const c = COLOR[a.color]
 const isActive = active === a.id
 return <button key={a.id} onClick={() => onSelect(a.id)} className={clsx('flex items-center gap-3 px-3 py-3 rounded-xl text-left transition-all border', isActive ? `${c.border} ${c.bg}` : 'border-transparent hover:bg-slate-800/50')}><div className={clsx('w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold shrink-0', isActive ? `${c.bg}` : 'bg-slate-900 text-slate-500')}>{a.num}</div><div className="flex-1 min-w-0"><div className={clsx('text-xs font-semibold', isActive ? c.text : 'text-slate-400')}>{a.title}</div><div className="text-[10px] text-slate-600 mt-0.5">{a.subtitle}</div></div></button>
 })}
 <div className="h-px bg-slate-800 my-1" />
 <button onClick={onSummary} className={clsx('flex items-center gap-3 px-3 py-3 rounded-xl text-left transition-all border', showSummary ? 'border-amber-500/40 bg-amber-500/10' : 'border-transparent hover:bg-slate-800/50')}><div className="w-8 h-8 rounded-lg bg-slate-900" /><div className="flex-1 min-w-0"><div className={clsx('text-xs font-semibold', showSummary ? 'text-amber-400' : 'text-slate-400')}>Final Summary</div><div className="text-[10px] text-slate-600 mt-0.5">All steps and outputs</div></div></button>
 <button onClick={onDataView} className={clsx('flex items-center gap-3 px-3 py-3 rounded-xl text-left transition-all border', showDataView ? 'border-cyan-500/40 bg-cyan-500/10' : 'border-transparent hover:bg-slate-800/50')}><div className="w-8 h-8 rounded-lg bg-slate-900" /><div className="flex-1 min-w-0"><div className={clsx('text-xs font-semibold', showDataView ? 'text-cyan-400' : 'text-slate-400')}>Data View</div><div className="text-[10px] text-slate-600 mt-0.5">Source vs transformed</div></div></button>
 </div>
 )
}

function AgentPanel({ logs, output }: { logs: RunLog[]; output?: AgentOutput }) {
 const reasoning = logs.filter(l => l.log_type === 'reasoning')
 const audit = logs.filter(l => l.log_type !== 'reasoning')
 return (
 <div className="flex-1 overflow-y-auto p-5 space-y-6">
 <JsonPanel title="Reasoning Steps" data={reasoning} />
 {output && <JsonPanel title="Agent Output" data={output.output} />}
 <JsonPanel title="Audit and Messages" data={audit} />
 </div>
 )
}

function SummaryTab({ run, agentOutputs, logs }: { run: MigrationRun; agentOutputs: AgentOutput[]; logs: RunLog[] }) {
 return (
 <div className="p-5 space-y-6">
 <div className="grid grid-cols-4 gap-3">
 <Metric label="Total Source" value={(run.total_source ?? 0).toLocaleString()} color="text-slate-300" />
 <Metric label="Loaded to FHIR" value={(run.total_loaded ?? 0).toLocaleString()} color="text-cyan-400" />
 <Metric label="Anomalies" value={String(run.anomaly_count ?? 0)} color="text-amber-400" />
 <Metric label="Compliance" value={`${run.compliance_score?.toFixed(1) ?? '0'}%`} color="text-emerald-400" />
 </div>
 <JsonPanel title="Agent Outputs" data={agentOutputs.map(a => ({ agent: a.agent, summary: a.summary, output: a.output }))} />
 <JsonPanel title="Run Logs" data={logs} />
 </div>
 )
}

function Metric({ label, value, color }: { label: string; value: string; color: string }) {
 return <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 text-center"><div className={clsx('text-3xl font-bold font-mono', color)}>{value}</div><div className="text-sm text-slate-500 mt-1">{label}</div></div>
}

export default function RunDetail({ run, onBack }: { run: MigrationRun; onBack: () => void }) {
 const [logs, setLogs] = useState<RunLog[]>([])
 const [agentOutputs, setAgentOutputs] = useState<AgentOutput[]>([])
 const [activeAgent, setActiveAgent] = useState<string>('discovery')
 const [showSummary, setShowSummary] = useState(false)
 const [showDataView, setShowDataView] = useState(false)
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

 const activeDef = AGENT_DEFS.find(a => a.id === activeAgent)
 const activeOutput = agentOutputs.find(a => a.agent === activeAgent)
 const activeLogs = logs.filter(l => l.agent === activeAgent || (activeAgent === 'orchestration' && l.agent === 'system'))

 return (
 <div className="flex flex-col h-full bg-[#0A0F1E]">
 <div className="flex items-center gap-4 px-5 py-3 border-b border-slate-800 shrink-0 bg-[#0D1424]">
 <button onClick={onBack} className="text-slate-500 hover:text-slate-200 text-sm transition-colors">Run History</button>
 <div className="h-4 w-px bg-slate-700" />
 <div className="flex items-center gap-2 flex-1 flex-wrap"><span className="text-white font-bold">{run.dataset_name}</span><span className="px-2 py-0.5 rounded text-xs font-semibold bg-slate-800 text-slate-300">{run.status}</span><span className="text-slate-600 text-xs font-mono">#{run.run_id.slice(-8).toUpperCase()}</span></div>
 </div>
 {loading ? <div className="flex items-center justify-center flex-1 text-slate-500">Loading run data...</div> : <div className="flex flex-1 gap-0 p-4 min-h-0"><Sidebar active={activeAgent} onSelect={(id) => { setActiveAgent(id); setShowSummary(false); setShowDataView(false) }} showSummary={showSummary} onSummary={() => { setShowSummary(true); setShowDataView(false) }} showDataView={showDataView} onDataView={() => { setShowDataView(true); setShowSummary(false) }} /><div className="flex-1 min-w-0 pl-4 overflow-hidden"><div className="h-full bg-[#0D1424] border border-slate-800 rounded-xl overflow-hidden flex flex-col">{showDataView ? <DataView runId={run.run_id} datasetName={run.dataset_name} /> : showSummary ? <SummaryTab run={run} agentOutputs={agentOutputs} logs={logs} /> : <><div className="px-5 py-4 border-b border-slate-800 shrink-0"><h2 className="text-white font-bold text-lg">{activeDef?.title}</h2><div className="text-slate-400 text-sm mt-0.5">{activeDef?.subtitle}</div></div><AgentPanel logs={activeLogs} output={activeOutput} /></>}</div></div></div>}
 </div>
 )
}
