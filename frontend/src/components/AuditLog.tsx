import { useState, useMemo } from 'react'
import clsx from 'clsx'
import { usePipelineStore } from '../store/pipelineStore'
import { AuditEntry } from '../types/pipeline'
import { exportPdf } from '../api/client'

const AGENT_PILL: Record<string, string> = {
 discovery: 'bg-blue-500/15 text-blue-400',
 transformation: 'bg-violet-500/15 text-violet-400',
 orchestration: 'bg-cyan-500/15 text-cyan-400',
 qa: 'bg-emerald-500/15 text-emerald-400',
 monitor: 'bg-orange-500/15 text-orange-400',
}

const STATUS_ROW: Record<string, string> = {
 success: 'border-l-2 border-emerald-500/60 bg-emerald-500/[0.03]',
 failed: 'border-l-2 border-red-500/60 bg-red-500/[0.03]',
 pending: 'border-l-2 border-amber-500/40 bg-amber-500/[0.02]',
 awaiting_approval:'border-l-2 border-amber-500/60 bg-amber-500/[0.04]',
}

const STATUS_DOT: Record<string, string> = {
 success: 'bg-emerald-500',
 failed: 'bg-red-500',
 pending: 'bg-amber-500',
 awaiting_approval: 'bg-amber-400',
}

function Row({ entry }: { entry: AuditEntry }) {
 const [expanded, setExpanded] = useState(false)
 return (
 <div
 className={clsx('px-3 py-2 text-xs border-b border-slate-800/50 cursor-pointer hover:bg-slate-800/20 transition-colors animate-slide-up', STATUS_ROW[entry.status] ?? '')}
 onClick={() => setExpanded(e => !e)}
 >
 <div className="flex items-center gap-2.5">
 <span className="text-slate-600 font-mono shrink-0 w-16 text-[10px]">
 {new Date(entry.timestamp).toLocaleTimeString('en-US', { hour12: false })}
 </span>
 <span className={clsx('px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0', AGENT_PILL[entry.agent] ?? 'bg-slate-700 text-slate-400')}>
 {entry.agent.slice(0, 5)}
 </span>
 <span className="text-slate-300 flex-1 truncate">{entry.action}</span>
 <div className="flex items-center gap-1.5 shrink-0">
 <span className={clsx('w-1.5 h-1.5 rounded-full shrink-0', STATUS_DOT[entry.status] ?? 'bg-slate-500')} />
 {entry.records_affected > 0 && (
 <span className="text-slate-500 font-mono">{entry.records_affected.toLocaleString()}</span>
 )}
 </div>
 </div>
 {expanded && entry.details && (
 <div className="mt-1.5 ml-[78px] text-[10px] text-slate-500 font-mono bg-slate-900/50 rounded px-2 py-1 break-words">
 {entry.details}
 </div>
 )}
 </div>
 )
}

export default function AuditLog() {
 const auditLog = usePipelineStore((s) => s.auditLog)
 const [agentFilter, setAgentFilter] = useState('')
 const [statusFilter, setStatusFilter] = useState('')
 const [search, setSearch] = useState('')

 const filtered = useMemo(() => auditLog.filter(e => {
 if (agentFilter && e.agent !== agentFilter) return false
 if (statusFilter && e.status !== statusFilter) return false
 if (search && !e.action.toLowerCase().includes(search.toLowerCase())) return false
 return true
 }), [auditLog, agentFilter, statusFilter, search])

 return (
 <div className="flex flex-col h-full bg-[#0D1424] border border-slate-800 rounded-xl overflow-hidden">
 {/* Header */}
 <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 shrink-0">
 <div className="flex items-center gap-2">
 <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Audit Log</span>
 <span className="px-1.5 py-0.5 bg-slate-800 rounded text-slate-500 text-xs">{filtered.length}</span>
 </div>
 <button
 onClick={exportPdf}
 className="flex items-center gap-1.5 px-3 py-1 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg text-slate-400 hover:text-slate-200 text-xs transition-all"
 >
 Export PDF
 </button>
 </div>

 {/* Filters */}
 <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-800 shrink-0 bg-slate-900/30">
 <input
 type="text" placeholder="Search..." value={search}
 onChange={e => setSearch(e.target.value)}
 className="bg-slate-900 border border-slate-700 rounded-md px-2.5 py-1 text-xs text-slate-300 placeholder-slate-600 focus:outline-none focus:border-blue-500 w-28"
 />
 <select value={agentFilter} onChange={e => setAgentFilter(e.target.value)}
 className="bg-slate-900 border border-slate-700 rounded-md px-2 py-1 text-xs text-slate-400 focus:outline-none focus:border-blue-500">
 <option value="">All Agents</option>
 {['discovery','transformation','orchestration','qa','monitor'].map(a => (
 <option key={a} value={a}>{a.charAt(0).toUpperCase() + a.slice(1)}</option>
 ))}
 </select>
 <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
 className="bg-slate-900 border border-slate-700 rounded-md px-2 py-1 text-xs text-slate-400 focus:outline-none focus:border-blue-500">
 <option value="">All Status</option>
 {['success','failed','pending','awaiting_approval'].map(s => (
 <option key={s} value={s}>{s.replace('_',' ')}</option>
 ))}
 </select>
 {(agentFilter || statusFilter || search) && (
 <button onClick={() => { setAgentFilter(''); setStatusFilter(''); setSearch('') }}
 className="text-xs text-slate-500 hover:text-slate-300"></button>
 )}
 </div>

 {/* Entries */}
 <div className="flex-1 overflow-y-auto">
 {filtered.length === 0 ? (
 <div className="flex items-center justify-center h-full text-slate-700 text-sm">
 {auditLog.length === 0 ? 'Pipeline activity will appear here' : 'No entries match filters'}
 </div>
 ) : (
 filtered.map((e, i) => <Row key={i} entry={e} />)
 )}
 </div>
 </div>
 )
}
