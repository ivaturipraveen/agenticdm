import { useState } from 'react'
import clsx from 'clsx'
import { usePipelineStore } from '../store/pipelineStore'
import { AgentName } from '../types/pipeline'
import { exportPdf } from '../api/client'

const AGENTS: { id: AgentName; num: number; title: string; subtitle: string; color: string }[] = [
 { id: 'discovery', num: 1, title: 'Discovery Agent', subtitle: 'Dynamic schema inspection and FHIR inference', color: 'blue' },
 { id: 'transformation', num: 2, title: 'Transformation Agent', subtitle: 'Schema-driven FHIR generation and validation', color: 'violet' },
 { id: 'orchestration', num: 3, title: 'Orchestration Agent', subtitle: 'Pipeline controller and bundle loader', color: 'cyan' },
 { id: 'qa', num: 4, title: 'QA / Reconciliation', subtitle: 'Count integrity and post-load verification', color: 'emerald' },
 { id: 'monitor', num: 5, title: 'Integration Monitor', subtitle: 'Live schema drift watcher', color: 'orange' },
]

const COLOR: Record<string, Record<string, string>> = {
 blue: { border: 'border-blue-500/40', bg: 'bg-blue-500/10', text: 'text-blue-400', badge: 'bg-blue-500/15 text-blue-400 border-blue-500/30', dot: 'bg-blue-400', ring: 'ring-blue-500/40' },
 violet: { border: 'border-violet-500/40', bg: 'bg-violet-500/10', text: 'text-violet-400', badge: 'bg-violet-500/15 text-violet-400 border-violet-500/30', dot: 'bg-violet-400', ring: 'ring-violet-500/40' },
 cyan: { border: 'border-cyan-500/40', bg: 'bg-cyan-500/10', text: 'text-cyan-400', badge: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30', dot: 'bg-cyan-400', ring: 'ring-cyan-500/40' },
 emerald: { border: 'border-emerald-500/40', bg: 'bg-emerald-500/10', text: 'text-emerald-400', badge: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30', dot: 'bg-emerald-400', ring: 'ring-emerald-500/40' },
 orange: { border: 'border-orange-500/40', bg: 'bg-orange-500/10', text: 'text-orange-400', badge: 'bg-orange-500/15 text-orange-400 border-orange-500/30', dot: 'bg-orange-400', ring: 'ring-orange-500/40' },
}

const STATUS_STYLES: Record<string, string> = {
 idle: 'bg-slate-800 text-slate-500 border-slate-700',
 running: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
 success: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
 failed: 'bg-red-500/15 text-red-400 border-red-500/30',
 watching: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
}

function AgentSidebar({ active, onSelect }: { active: AgentName; onSelect: (a: AgentName) => void }) {
 const agents = usePipelineStore((s) => s.agents)
 return (
 <div className="w-56 shrink-0 flex flex-col gap-1 pr-2 border-r border-slate-800 overflow-y-auto">
 <div className="text-[10px] text-slate-600 uppercase tracking-wider font-semibold px-2 pb-2">Agents</div>
 {AGENTS.map(a => {
 const state = agents[a.id]
 const c = COLOR[a.color]
 const isActive = active === a.id
 return (
 <button key={a.id} onClick={() => onSelect(a.id)} className={clsx('flex items-center gap-3 px-3 py-3 rounded-xl text-left transition-all border', isActive ? `${c.border} ${c.bg} border` : 'border-transparent hover:bg-slate-800/50')}>
 <div className={clsx('w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold shrink-0', isActive ? `${c.bg} ring-2 ${c.ring}` : 'bg-slate-900 text-slate-500')}>{a.num}</div>
 <div className="flex-1 min-w-0">
 <div className={clsx('text-xs font-semibold truncate', isActive ? c.text : 'text-slate-400')}>{a.title}</div>
 <div className="text-[10px] text-slate-600 truncate mt-0.5">{a.subtitle}</div>
 </div>
 <div className="shrink-0">
 {state.status === 'running' && <span className={clsx('w-2 h-2 rounded-full block animate-pulse', c.dot)} />}
 {state.status === 'success' && <span className="w-2 h-2 rounded-full block bg-emerald-400" />}
 {state.status === 'failed' && <span className="w-2 h-2 rounded-full block bg-red-400" />}
 {state.status === 'watching' && <span className="w-2 h-2 rounded-full block bg-orange-400 animate-pulse" />}
 </div>
 </button>
 )
 })}
 <div className="mt-auto pt-3 border-t border-slate-800">
 <button onClick={exportPdf} className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-slate-800/50 text-xs transition-all">Export Audit PDF</button>
 </div>
 </div>
 )
}

function AgentDetail({ agentId }: { agentId: AgentName }) {
 const agentDef = AGENTS.find(a => a.id === agentId)!
 const state = usePipelineStore((s) => s.agents[agentId])
 const schemaMapping = usePipelineStore((s) => s.schemaMapping)
 const reconciliation = usePipelineStore((s) => s.reconciliation)
 const migrationSummary = usePipelineStore((s) => s.migrationSummary)
 const auditLog = usePipelineStore((s) => s.auditLog)
 const c = COLOR[agentDef.color]
 const agentAuditEntries = auditLog.filter(e => e.agent === agentId).slice(0, 20)
 const [showSamples, setShowSamples] = useState(true)

 return (
 <div className="flex flex-col h-full overflow-hidden">
 <div className={clsx('flex items-center gap-4 px-5 py-4 border-b border-slate-800', c.bg + '/30')}>
 <div className={clsx('w-12 h-12 rounded-xl flex items-center justify-center text-xl font-bold border', c.border, c.bg)}>{agentDef.num}</div>
 <div className="flex-1">
 <div className="flex items-center gap-3">
 <h2 className="text-white font-bold text-lg">{agentDef.title}</h2>
 <span className={clsx('px-2.5 py-0.5 rounded-full border text-xs font-semibold', STATUS_STYLES[state.status])}>{state.status.charAt(0).toUpperCase() + state.status.slice(1)}</span>
 </div>
 <div className="text-slate-400 text-sm mt-0.5">{agentDef.subtitle}</div>
 </div>
 {state.records_processed > 0 && <div className="text-right shrink-0"><div className={clsx('text-2xl font-bold font-mono', c.text)}>{state.records_processed.toLocaleString()}</div><div className="text-xs text-slate-500">records processed</div></div>}
 </div>

 <div className="flex-1 overflow-y-auto p-5 space-y-5">
 {state.reasoning.length > 0 && (
 <Section title="Agent Reasoning" subtitle="Live step-by-step decision log">
 <div className="space-y-2">
 {state.reasoning.map((r, i) => (
 <div key={i} className="flex gap-3 p-3 bg-slate-900/50 rounded-lg border border-slate-800/60">
 <div className="flex-1 min-w-0">
 <div className={clsx('text-sm font-medium', i === state.reasoning.length - 1 && state.status === 'running' ? 'text-white' : 'text-slate-300')}>{r.step}</div>
 {r.detail && <div className="text-xs text-slate-500 font-mono mt-1 break-all whitespace-pre-wrap">{r.detail}</div>}
 </div>
 </div>
 ))}
 </div>
 </Section>
 )}

 {agentId === 'discovery' && schemaMapping && (
 <Section title="Output: Dynamic Mapping Contract" subtitle="Inferred resources, field confidence, review queue, and unmapped fields">
 <div className="space-y-4">
 {schemaMapping.mapping_summary.map((tableMap) => (
 <div key={tableMap.table} className="rounded-lg border border-slate-800 overflow-hidden bg-slate-900/30">
 <div className="flex items-center justify-between px-4 py-3 bg-slate-900/70 border-b border-slate-800">
 <div>
 <div className="text-white font-semibold">{tableMap.table} {'->'} {tableMap.resource}</div>
 <div className="text-xs text-slate-500 mt-1">Confidence {Math.round(tableMap.resource_confidence * 100)}% • {tableMap.resource_reasoning.join(', ')}</div>
 </div>
 <div className="text-right text-xs text-slate-500">
 <div>{tableMap.row_count.toLocaleString()} rows</div>
 <div>{tableMap.fields.length} fields scored</div>
 </div>
 </div>
 <div className="grid grid-cols-12 text-[11px] text-slate-500 border-b border-slate-800 bg-slate-900/40 px-4 py-2 font-semibold">
 <div className="col-span-2">Column</div>
 <div className="col-span-4">Target</div>
 <div className="col-span-1">Score</div>
 <div className="col-span-2">Status</div>
 <div className="col-span-3">Reason</div>
 </div>
 {tableMap.fields.map((field) => (
 <div key={field.source_column} className="grid grid-cols-12 gap-2 px-4 py-2 text-xs border-b border-slate-800/40 last:border-0">
 <div className="col-span-2 font-mono text-slate-300">{field.source_column}</div>
 <div className="col-span-4 font-mono text-blue-400 break-all">{field.target_field || 'UNMAPPED'}</div>
 <div className="col-span-1 text-white font-mono">{Math.round(field.confidence * 100)}%</div>
 <div className="col-span-2">
 <span className={clsx('px-2 py-0.5 rounded border text-[10px] uppercase tracking-wide', field.status === 'auto_mapped' ? 'border-emerald-500/30 text-emerald-400 bg-emerald-500/10' : field.status === 'requires_review' ? 'border-amber-500/30 text-amber-400 bg-amber-500/10' : 'border-slate-700 text-slate-500 bg-slate-800/50')}>{field.status.replace('_', ' ')}</span>
 </div>
 <div className="col-span-3 text-slate-500">{field.reason}</div>
 </div>
 ))}
 </div>
 ))}

 <div className="grid grid-cols-3 gap-3">
 <StatCard label="Auto-mapped Fields" value={schemaMapping.summary.auto_mapped_fields} color="text-emerald-400" />
 <StatCard label="Requires Review" value={schemaMapping.summary.requires_review_fields} color="text-amber-400" />
 <StatCard label="Ignored Fields" value={schemaMapping.summary.ignored_fields} color="text-slate-400" />
 </div>
 </div>
 </Section>
 )}

 {agentId === 'transformation' && migrationSummary && (
 <Section title="Output: Transformation Results" subtitle="FHIR generation, review queue, validation failures, and sample outputs">
 <div className="space-y-4">
 <div className="grid grid-cols-4 gap-3">
 <StatCard label="Source Records" value={(migrationSummary.total_source as number) || 0} color="text-slate-300" />
 <StatCard label="FHIR Generated" value={(migrationSummary.total_loaded as number) || 0} color="text-violet-400" />
 <StatCard label="Review Items" value={((migrationSummary.agent_outputs as any)?.review_items?.length) || 0} color="text-amber-400" />
 <StatCard label="Validation Errors" value={((migrationSummary.agent_outputs as any)?.validation_errors?.length) || 0} color="text-red-400" />
 </div>

 <div className="rounded-lg border border-slate-800 overflow-hidden bg-slate-900/30">
 <div className="px-4 py-3 border-b border-slate-800 text-sm font-semibold text-white">FHIR Samples</div>
 <div className="px-4 py-3">
 <button onClick={() => setShowSamples(v => !v)} className="mb-3 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-300">{showSamples ? 'Hide Samples' : 'Show Samples'}</button>
 {showSamples && <pre className="text-xs text-slate-300 overflow-x-auto whitespace-pre-wrap">{JSON.stringify((migrationSummary.agent_outputs as any)?.fhir_samples || [], null, 2)}</pre>}
 </div>
 </div>

 <div className="grid grid-cols-2 gap-4">
 <JsonPanel title="Requires Review" data={(migrationSummary.agent_outputs as any)?.review_items || []} />
 <JsonPanel title="Validation Errors" data={(migrationSummary.agent_outputs as any)?.validation_errors || []} />
 </div>
 </div>
 </Section>
 )}

 {agentId === 'orchestration' && migrationSummary && (
 <Section title="Output: Final Load Summary" subtitle="Resource counts, compliance, and final generated outputs">
 <div className="space-y-4">
 <div className="grid grid-cols-4 gap-3">
 <StatCard label="Loaded" value={(migrationSummary.total_loaded as number) || 0} color="text-cyan-400" />
 <StatCard label="Anomalies" value={(migrationSummary.anomalies as number) || 0} color="text-amber-400" />
 <StatCard label="Compliance" value={`${((migrationSummary.compliance as any)?.overall_score ?? 0).toFixed(1)}%`} color="text-emerald-400" />
 <StatCard label="Match Rate" value={`${((migrationSummary.reconciliation as any)?.match_pct ?? 0).toFixed(1)}%`} color="text-blue-400" />
 </div>
 <JsonPanel title="Final Agent Outputs" data={migrationSummary.agent_outputs || {}} />
 </div>
 </Section>
 )}

 {agentId === 'qa' && reconciliation && (
 <Section title="Output: Reconciliation Report" subtitle="Source vs FHIR target comparison">
 <div className="grid grid-cols-3 gap-3">
 <StatCard label="Source Records" value={reconciliation.source_count} color="text-slate-300" />
 <StatCard label="FHIR Target" value={reconciliation.target_count} color="text-blue-400" />
 <StatCard label="Match Rate" value={`${reconciliation.match_pct}%`} color="text-emerald-400" />
 <StatCard label="Matched" value={reconciliation.matched} color="text-emerald-400" />
 <StatCard label="Anomalies" value={reconciliation.anomalies_quarantined} color="text-amber-400" />
 <StatCard label="Violations" value={reconciliation.violations} color={reconciliation.violations > 0 ? 'text-red-400' : 'text-slate-500'} />
 </div>
 </Section>
 )}

 {agentAuditEntries.length > 0 && (
 <Section title="Audit Trail" subtitle="All logged actions for this agent">
 <div className="space-y-1">
 {agentAuditEntries.map((e, i) => (
 <div key={i} className={clsx('flex items-start gap-3 p-2.5 rounded-lg text-xs border', e.status === 'success' ? 'bg-emerald-500/5 border-emerald-500/20' : e.status === 'failed' ? 'bg-red-500/5 border-red-500/20' : e.status === 'awaiting_approval' ? 'bg-amber-500/5 border-amber-500/20' : 'bg-slate-900/40 border-slate-800')}>
 <span className="text-slate-600 font-mono shrink-0 text-[10px] mt-0.5">{new Date(e.timestamp).toLocaleTimeString('en-US', { hour12: false })}</span>
 <div className="flex-1 min-w-0"><div className="text-slate-300">{e.action}</div>{e.details && <div className="text-slate-600 font-mono text-[10px] mt-0.5 truncate">{e.details}</div>}</div>
 <div className="flex items-center gap-2 shrink-0">{e.records_affected > 0 && <span className="text-slate-500 font-mono">{e.records_affected.toLocaleString()}</span>}<span className={clsx('px-1.5 py-0.5 rounded text-[10px] font-medium', e.status === 'success' ? 'bg-emerald-500/15 text-emerald-400' : e.status === 'failed' ? 'bg-red-500/15 text-red-400' : 'bg-amber-500/15 text-amber-400')}>{e.status}</span></div>
 </div>
 ))}
 </div>
 </Section>
 )}
 </div>
 </div>
 )
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
 return <div><div className="mb-3"><div className="text-sm font-bold text-white">{title}</div>{subtitle && <div className="text-xs text-slate-500 mt-0.5">{subtitle}</div>}</div>{children}</div>
}

function StatCard({ label, value, color }: { label: string; value: string | number; color: string }) {
 return <div className="bg-slate-900/60 border border-slate-800 rounded-lg p-3 text-center"><div className={clsx('text-xl font-bold font-mono', color)}>{typeof value === 'number' ? value.toLocaleString() : value}</div><div className="text-[11px] text-slate-500 mt-0.5">{label}</div></div>
}

function JsonPanel({ title, data }: { title: string; data: unknown }) {
 return (
 <div className="rounded-lg border border-slate-800 overflow-hidden bg-slate-900/30">
 <div className="px-4 py-3 border-b border-slate-800 text-sm font-semibold text-white">{title}</div>
 <pre className="p-4 text-xs text-slate-300 overflow-x-auto whitespace-pre-wrap">{JSON.stringify(data, null, 2)}</pre>
 </div>
 )
}

export default function MigrationView() {
 const activeTab = usePipelineStore((s) => s.activeAgentTab)
 const setActiveTab = usePipelineStore((s) => s.setActiveAgentTab)
 const stage = usePipelineStore((s) => s.stage)
 const resetFn = usePipelineStore((s) => s.resetPipeline)
 const isDone = stage === 'COMPLETE' || stage === 'HALTED'
 return (
 <div className="flex flex-col h-full">
 {isDone && <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-800 bg-[#0D1424] shrink-0"><div className={clsx('flex items-center gap-2 text-sm font-semibold', stage === 'COMPLETE' ? 'text-emerald-400' : 'text-red-400')}>{stage === 'COMPLETE' ? 'Migration Complete' : 'Pipeline Halted'}</div><button onClick={resetFn} className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white font-semibold text-sm rounded-lg transition-all">New Migration</button></div>}
 <div className="flex flex-1 gap-0 p-4 min-h-0"><AgentSidebar active={activeTab} onSelect={setActiveTab} /><div className="flex-1 min-w-0 pl-4 overflow-hidden"><div className="h-full bg-[#0D1424] border border-slate-800 rounded-xl overflow-hidden"><AgentDetail agentId={activeTab} /></div></div></div>
 </div>
 )
}
