import { usePipelineStore } from '../store/pipelineStore'

export default function SchemaDriftDrawer() {
 const drift = usePipelineStore((s) => s.schemaDrift)
 const open = usePipelineStore((s) => s.driftDrawerOpen)
 const setOpen = usePipelineStore((s) => s.setDriftDrawerOpen)

 if (!open || !drift) return null

 return (
 <div className="fixed inset-0 z-50 flex">
 <div className="flex-1 bg-black/50 backdrop-blur-sm" onClick={() => setOpen(false)} />
 <div className="w-[420px] bg-[#0D1424] border-l border-slate-800 flex flex-col shadow-2xl">
 <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
 <div>
 <div className="text-white font-bold text-sm">Schema Drift — Field Mapping Diff</div>
 <div className="text-slate-500 text-xs mt-0.5">Review changes before confirming</div>
 </div>
 <button onClick={() => setOpen(false)} className="text-slate-500 hover:text-white text-xl leading-none"></button>
 </div>

 <div className="flex-1 overflow-y-auto p-5 space-y-4">
 <div>
 <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Detected Changes</div>
 <div className="space-y-2">
 {drift.column_changes.map((c, i) => (
 <div key={i} className={`p-3 rounded-lg border text-xs ${
 c.change_type === 'added' ? 'bg-emerald-500/5 border-emerald-500/30 text-emerald-300' :
 c.change_type === 'removed' ? 'bg-red-500/5 border-red-500/30 text-red-300' :
 'bg-amber-500/5 border-amber-500/30 text-amber-300'
 }`}>
 <div className="flex items-center gap-2">
 <span className="font-mono font-bold text-base">{c.change_type === 'added' ? '+' : c.change_type === 'removed' ? '−' : '~'}</span>
 <span className="font-semibold">{c.table}.{c.column}</span>
 <span className="uppercase text-[10px] opacity-60 ml-auto">{c.change_type}</span>
 </div>
 {c.old_type && <div className="mt-1 opacity-60 font-mono">was: {c.old_type}</div>}
 {c.new_type && <div className="opacity-60 font-mono">now: {c.new_type}</div>}
 </div>
 ))}
 </div>
 </div>

 <div>
 <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Proposed Mapping Update</div>
 <div className="bg-slate-900 rounded-lg border border-slate-800 font-mono text-xs p-4 space-y-1.5">
 {Object.entries(drift.proposed_mapping).map(([col, mapping]) => (
 <div key={col} className="flex gap-2">
 <span className={mapping.includes('REMOVED') ? 'text-red-400' : 'text-emerald-400'}>
 {mapping.includes('REMOVED') ? '−' : '+'}
 </span>
 <span className="text-slate-400">{col}:</span>
 <span className={mapping.includes('REMOVED') ? 'text-red-300' : 'text-emerald-300'}>{mapping}</span>
 </div>
 ))}
 </div>
 </div>
 </div>
 </div>
 </div>
 )
}
