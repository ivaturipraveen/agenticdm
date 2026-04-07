import clsx from 'clsx'
import { usePipelineStore } from '../store/pipelineStore'
import { AgentName, AgentState, SchemaMapping } from '../types/pipeline'

const AGENTS: { id: AgentName; num: number; title: string; subtitle: string; color: string }[] = [
 { id: 'discovery', num: 1, title: 'Discovery Agent', subtitle: 'Schema scanner & FHIR mapper', color: 'blue' },
 { id: 'transformation', num: 2, title: 'Transformation Agent', subtitle: 'Data normalizer & ICD-10 validator', color: 'violet' },
 { id: 'orchestration', num: 3, title: 'Orchestration Agent', subtitle: 'Pipeline controller & FHIR loader', color: 'cyan' },
 { id: 'qa', num: 4, title: 'QA / Reconciliation', subtitle: 'Post-load verifier & checksum checker', color: 'emerald' },
 { id: 'monitor', num: 5, title: 'Integration Monitor', subtitle: 'Schema drift watcher (live)', color: 'orange' },
]

const COLOR_MAP: Record<string, Record<string, string>> = {
 blue: { tab: 'border-blue-500 text-blue-400', badge: 'bg-blue-500/15 text-blue-400 border-blue-500/30', dot: 'bg-blue-400', ring: 'ring-blue-500/30' },
 violet: { tab: 'border-violet-500 text-violet-400', badge: 'bg-violet-500/15 text-violet-400 border-violet-500/30', dot: 'bg-violet-400', ring: 'ring-violet-500/30' },
 cyan: { tab: 'border-cyan-500 text-cyan-400', badge: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30', dot: 'bg-cyan-400', ring: 'ring-cyan-500/30' },
 emerald: { tab: 'border-emerald-500 text-emerald-400', badge: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30', dot: 'bg-emerald-400', ring: 'ring-emerald-500/30' },
 orange: { tab: 'border-orange-500 text-orange-400', badge: 'bg-orange-500/15 text-orange-400 border-orange-500/30', dot: 'bg-orange-400', ring: 'ring-orange-500/30' },
}

const STATUS_BADGE: Record<string, string> = {
 idle: 'bg-slate-800 text-slate-500 border-slate-700',
 running: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
 success: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
 failed: 'bg-red-500/15 text-red-400 border-red-500/30',
 watching: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
}

function AgentTab({ agent, isActive, onClick }: { agent: typeof AGENTS[0]; state: AgentState; isActive: boolean; onClick: () => void }) {
 const agentState = usePipelineStore((s) => s.agents[agent.id])
 const colors = COLOR_MAP[agent.color]
 const isRunning = agentState.status === 'running'
 const hasActivity = agentState.reasoning.length > 0 || agentState.records_processed > 0

 return (
 <button
 onClick={onClick}
 className={clsx(
 'flex items-center gap-2.5 px-4 py-3 border-b-2 text-sm font-medium transition-all whitespace-nowrap',
 isActive ? colors.tab : 'border-transparent text-slate-500 hover:text-slate-300'
 )}
 >
 <div className={clsx('w-6 h-6 rounded-md flex items-center justify-center text-xs font-bold shrink-0',
 isActive ? `ring-2 ${colors.ring} bg-slate-800` : 'bg-slate-800'
 )}>
 {agent.num}
 </div>
 <span className="hidden sm:block">{agent.title.replace(' Agent', '').replace(' / Reconciliation', '')}</span>
 {isRunning && <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-ping" />}
 {!isRunning && hasActivity && agentState.status === 'success' && (
 <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
 )}
 {agentState.status === 'failed' && <span className="w-1.5 h-1.5 rounded-full bg-red-400" />}
 </button>
 )
}

function ReasoningStream({ agentId }: { agentId: AgentName }) {
 const reasoning = usePipelineStore((s) => s.agents[agentId].reasoning)
 const status = usePipelineStore((s) => s.agents[agentId].status)

 if (reasoning.length === 0) {
 return (
 <div className="flex flex-col items-center justify-center h-full gap-3 text-slate-600">
 <div className="text-3xl opacity-30"></div>
 <div className="text-sm text-center">Agent {agentId === 'monitor' ? 'is watching for schema drift' : 'has not started yet'}</div>
 </div>
 )
 }

 return (
 <div className="space-y-2 p-4">
 {reasoning.map((r, i) => (
 <div key={i} className="reasoning-line flex gap-3 text-sm">
 <div className="shrink-0 w-6 text-center">{r.emoji}</div>
 <div className="flex-1 min-w-0">
 <div className={clsx('font-medium', i === reasoning.length - 1 && status === 'running' ? 'text-white' : 'text-slate-300')}>
 {r.step}
 </div>
 {r.detail && (
 <div className="text-xs text-slate-500 mt-0.5 font-mono break-words">{r.detail}</div>
 )}
 <div className="text-[10px] text-slate-600 mt-0.5">{new Date(r.timestamp).toLocaleTimeString()}</div>
 </div>
 {i === reasoning.length - 1 && status === 'running' && (
 <div className="flex gap-1 items-center shrink-0 mt-1">
 {[0, 1, 2].map(d => (
 <span key={d} className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-typing" style={{ animationDelay: `${d * 0.2}s` }} />
 ))}
 </div>
 )}
 </div>
 ))}
 </div>
 )
}

function AgentStatsBar({ agentId, color }: { agentId: AgentName; color: string }) {
 const agent = usePipelineStore((s) => s.agents[agentId])
 const colors = COLOR_MAP[color]

 return (
 <div className="flex items-center gap-4 px-4 py-2 bg-slate-900/50 border-b border-slate-800 text-xs">
 <div className={clsx('flex items-center gap-1.5 px-2 py-0.5 rounded-full border font-medium', STATUS_BADGE[agent.status])}>
 {agent.status === 'running' && <span className={clsx('w-1.5 h-1.5 rounded-full animate-pulse', colors.dot)} />}
 {agent.status.charAt(0).toUpperCase() + agent.status.slice(1)}
 </div>
 {agent.records_processed > 0 && (
 <div className="text-slate-400">
 <span className="text-slate-500">Records: </span>
 <span className="text-white font-mono font-semibold">{agent.records_processed.toLocaleString()}</span>
 </div>
 )}
 {agent.last_action && (
 <div className="text-slate-500 truncate flex-1">{agent.last_action}</div>
 )}
 {agent.last_active && (
 <div className="text-slate-600 shrink-0">{new Date(agent.last_active).toLocaleTimeString()}</div>
 )}
 </div>
 )
}

export default function AgentWorkspace() {
 const activeTab = usePipelineStore((s) => s.activeAgentTab)
 const setActiveTab = usePipelineStore((s) => s.setActiveAgentTab)
 const agents = usePipelineStore((s) => s.agents)
 const schemaMapping = usePipelineStore((s) => s.schemaMapping)
 const reconciliation = usePipelineStore((s) => s.reconciliation)

 const activeAgent = AGENTS.find(a => a.id === activeTab)!

 return (
 <div className="flex flex-col h-full bg-[#0D1424] border border-slate-800 rounded-xl overflow-hidden">
 {/* Agent Tabs */}
 <div className="flex border-b border-slate-800 overflow-x-auto shrink-0 bg-[#0A0F1E]">
 {AGENTS.map((agent) => (
 <AgentTab
 key={agent.id}
 agent={agent}
 state={agents[agent.id]}
 isActive={activeTab === agent.id}
 onClick={() => setActiveTab(agent.id)}
 />
 ))}
 </div>

 {/* Agent Header */}
 <div className="px-4 py-3 border-b border-slate-800 shrink-0">
 <div className="flex items-center gap-3">
 <div className={clsx('w-8 h-8 rounded-lg flex items-center justify-center text-white font-bold text-sm',
 `bg-${activeAgent.color}-500/20 border border-${activeAgent.color}-500/30`
 )}>
 {activeAgent.num}
 </div>
 <div>
 <div className="text-white font-semibold text-sm">{activeAgent.title}</div>
 <div className="text-slate-500 text-xs">{activeAgent.subtitle}</div>
 </div>
 </div>
 </div>

 {/* Stats bar */}
 <AgentStatsBar agentId={activeTab} color={activeAgent.color} />

 {/* Content — Reasoning stream OR special output panel */}
 <div className="flex-1 overflow-y-auto">
 {activeTab === 'discovery' && schemaMapping && agents.discovery.status === 'success' ? (
 <SchemaMappingOutput mapping={schemaMapping} />
 ) : activeTab === 'qa' && reconciliation ? (
 <ReconciliationOutput report={reconciliation} />
 ) : (
 <ReasoningStream agentId={activeTab} />
 )}
 </div>
 </div>
 )
}

function SchemaMappingOutput({ mapping }: { mapping: SchemaMapping }) {
 return (
 <div className="p-4 space-y-4">
 <div className="flex items-center gap-2 text-emerald-400 text-sm font-semibold">
 <span></span> Schema mapping complete — {mapping.summary?.total_rows?.toLocaleString()} records discovered
 </div>
 {Object.entries(mapping.schema || {}).map(([table, info]: [string, any]) => (
 <div key={table} className="bg-slate-900/60 rounded-lg border border-slate-800 overflow-hidden">
 <div className="flex items-center justify-between px-4 py-2 bg-slate-800/50 border-b border-slate-800">
 <div className="flex items-center gap-2">
 <span className="text-xs font-mono text-slate-400">{table}</span>
 <span className="px-1.5 py-0.5 bg-blue-500/20 text-blue-400 text-[10px] rounded font-mono"> FHIR {info.fhir_resource}</span>
 </div>
 <span className="text-xs text-slate-500">{info.row_count?.toLocaleString()} rows</span>
 </div>
 <div className="divide-y divide-slate-800/50">
 {info.columns?.slice(0, 8).map((col: any) => (
 <div key={col.name} className="flex items-center gap-3 px-4 py-1.5 text-xs hover:bg-slate-800/30 transition-colors">
 <span className={clsx('w-1.5 h-1.5 rounded-full shrink-0', col.flagged ? 'bg-amber-400' : 'bg-slate-600')} />
 <span className="font-mono text-slate-300 w-36 shrink-0">{col.name}</span>
 <span className="text-slate-600 w-24 shrink-0">{col.type}</span>
 <span className="text-blue-400/70 font-mono truncate">{col.fhir_target}</span>
 {col.flagged && <span className="ml-auto text-amber-400 text-[10px]"> unmapped</span>}
 </div>
 ))}
 {info.columns?.length > 8 && (
 <div className="px-4 py-1.5 text-xs text-slate-600">+{info.columns.length - 8} more columns</div>
 )}
 </div>
 </div>
 ))}
 </div>
 )
}

function ReconciliationOutput({ report }: { report: any }) {
 const checks = [
 { label: 'member_id checksum', passed: report.checksum_member_id },
 { label: 'claim_amount checksum', passed: report.checksum_claim_amount },
 { label: 'date_of_service checksum', passed: report.checksum_date_of_service },
 ]

 return (
 <div className="p-4 space-y-4">
 <div className="flex items-center gap-2 text-emerald-400 text-sm font-semibold">
 <span></span> Reconciliation complete — {report.match_pct}% match rate
 </div>

 <div className="grid grid-cols-2 gap-3">
 {[
 { label: 'Source Records', val: report.source_count, color: 'text-slate-300' },
 { label: 'FHIR Target', val: report.target_count, color: 'text-blue-400' },
 { label: 'Matched', val: report.matched, color: 'text-emerald-400' },
 { label: 'Anomalies', val: report.anomalies_quarantined, color: 'text-amber-400' },
 { label: 'Missing', val: report.missing, color: report.missing > 0 ? 'text-red-400' : 'text-slate-500' },
 { label: 'Violations', val: report.violations, color: report.violations > 0 ? 'text-red-400' : 'text-slate-500' },
 ].map(m => (
 <div key={m.label} className="bg-slate-900/60 border border-slate-800 rounded-lg p-3">
 <div className={clsx('text-xl font-bold font-mono', m.color)}>{m.val.toLocaleString()}</div>
 <div className="text-xs text-slate-500 mt-0.5">{m.label}</div>
 </div>
 ))}
 </div>

 <div className="bg-slate-900/60 border border-slate-800 rounded-lg overflow-hidden">
 <div className="px-3 py-2 text-xs font-semibold text-slate-400 border-b border-slate-800">Checksum Verification</div>
 {checks.map(c => (
 <div key={c.label} className="flex items-center justify-between px-3 py-2 text-sm border-b border-slate-800/50 last:border-0">
 <span className="text-slate-400 font-mono text-xs">{c.label}</span>
 <span className={c.passed ? 'text-emerald-400 font-semibold text-xs' : 'text-red-400 font-semibold text-xs'}>
 {c.passed ? ' PASS' : ' FAIL'}
 </span>
 </div>
 ))}
 </div>

 <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-lg p-3 text-sm text-emerald-400">
 Migration Run Complete — {report.match_pct}% data integrity verified
 </div>
 </div>
 )
}
