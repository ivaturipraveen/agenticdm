import { usePipelineStore } from '../store/pipelineStore'

export default function SchemaDriftDrawer() {
  const drift = usePipelineStore((s) => s.schemaDrift)
  const open = usePipelineStore((s) => s.driftDrawerOpen)
  const setOpen = usePipelineStore((s) => s.setDriftDrawerOpen)

  if (!open || !drift) return null

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/30 backdrop-blur-sm" onClick={() => setOpen(false)} />
      <div className="w-[420px] bg-white border-l border-slate-200 flex flex-col shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 bg-slate-50">
          <div>
            <div className="text-slate-900 font-bold text-sm">Schema Drift — Field Mapping Diff</div>
            <div className="text-slate-500 text-xs mt-0.5">Review changes before confirming</div>
          </div>
          <button onClick={() => setOpen(false)} className="text-slate-500 hover:text-slate-900 text-xl leading-none">&times;</button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-4 bg-slate-50/50">
          <div>
            <div className="text-xs font-semibold text-slate-600 uppercase tracking-wider mb-2">Detected Changes</div>
            <div className="space-y-2">
              {drift.column_changes.map((c, i) => (
                <div key={i} className={`p-3 rounded-xl border text-xs ${
                  c.change_type === 'added' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' :
                  c.change_type === 'removed' ? 'bg-red-50 border-red-200 text-red-800' :
                  'bg-amber-50 border-amber-200 text-amber-800'
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
            <div className="text-xs font-semibold text-slate-600 uppercase tracking-wider mb-2">Proposed Mapping Update</div>
            <div className="bg-white rounded-xl border border-slate-200 font-mono text-xs p-4 space-y-1.5 shadow-sm">
              {Object.entries(drift.proposed_mapping).map(([col, mapping]) => (
                <div key={col} className="flex gap-2">
                  <span className={(mapping as string).includes('REMOVED') ? 'text-red-600' : 'text-emerald-600'}>
                    {(mapping as string).includes('REMOVED') ? '−' : '+'}
                  </span>
                  <span className="text-slate-600">{col}:</span>
                  <span className={(mapping as string).includes('REMOVED') ? 'text-red-700' : 'text-emerald-700'}>{mapping as string}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
