import clsx from 'clsx'
import { AgentState } from '../types/pipeline'
import { usePipelineStore } from '../store/pipelineStore'

const AGENT_LABELS: Record<string, { title: string; subtitle: string }> = {
 discovery: { title: 'Discovery Agent', subtitle: 'Schema scanner & mapper' },
 transformation: { title: 'Transformation Agent', subtitle: 'Data normalizer & validator' },
 orchestration: { title: 'Orchestration Agent', subtitle: 'Pipeline controller' },
 qa: { title: 'QA / Reconciliation', subtitle: 'Post-load verifier' },
 monitor: { title: 'Integration Monitor', subtitle: 'Schema drift watcher' },
}

const STATUS_STYLES: Record<string, string> = {
 idle: 'bg-slate-800 text-slate-400 border border-slate-700',
 running: 'bg-blue-500/15 text-blue-400 border border-blue-500/40',
 success: 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/40',
 failed: 'bg-red-500/15 text-red-400 border border-red-500/40',
 watching: 'bg-slate-700/50 text-slate-300 border border-slate-600',
}

const STATUS_DOT: Record<string, string> = {
 idle: 'bg-slate-500',
 running: 'bg-blue-400 animate-pulse',
 success: 'bg-emerald-400',
 failed: 'bg-red-400',
 watching: 'bg-slate-400 animate-pulse',
}

function formatTime(ts: string | null): string {
 if (!ts) return '—'
 try {
 return new Date(ts).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
 } catch {
 return ts
 }
}

interface Props {
 agent: AgentState
}

export default function AgentCard({ agent }: Props) {
 const schemaDrift = usePipelineStore((s) => s.schemaDrift)
 const label = AGENT_LABELS[agent.name] ?? { title: agent.name, subtitle: '' }
 const isDriftAgent = agent.name === 'monitor'
 const hasDrift = isDriftAgent && schemaDrift !== null

 return (
 <div className={clsx(
 'rounded-lg border p-4 transition-all duration-300',
 hasDrift ? 'border-red-500 bg-red-500/5 animate-pulse-red' : 'border-navy-border bg-navy-light',
 )}>
 <div className="flex items-start justify-between mb-3">
 <div>
 <div className="text-white font-semibold text-sm">{label.title}</div>
 <div className="text-slate-500 text-xs mt-0.5">{label.subtitle}</div>
 </div>
 <div className={clsx('flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium', STATUS_STYLES[agent.status])}>
 <span className={clsx('w-1.5 h-1.5 rounded-full', STATUS_DOT[agent.status])} />
 {agent.status === 'watching' && isDriftAgent && !hasDrift ? ' Watching' : agent.status.charAt(0).toUpperCase() + agent.status.slice(1)}
 </div>
 </div>

 {hasDrift && (
 <div className="mb-3 px-2 py-1.5 bg-red-500/10 border border-red-500/30 rounded text-red-400 text-xs font-bold">
 SCHEMA DRIFT DETECTED
 </div>
 )}

 <div className="space-y-1.5">
 <div className="text-xs text-slate-400 truncate" title={agent.last_action}>
 <span className="text-slate-500">Last: </span>{agent.last_action || '—'}
 </div>
 <div className="flex justify-between text-xs">
 <span className="text-slate-500">Records</span>
 <span className="text-slate-300 font-mono">{agent.records_processed.toLocaleString()}</span>
 </div>
 <div className="flex justify-between text-xs">
 <span className="text-slate-500">Active</span>
 <span className="text-slate-400 font-mono">{formatTime(agent.last_active)}</span>
 </div>
 </div>
 </div>
 )
}
