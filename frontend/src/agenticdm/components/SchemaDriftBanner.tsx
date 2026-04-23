import { usePipelineStore } from '../store/pipelineStore'

export default function SchemaDriftBanner() {
  const schemaDrift = usePipelineStore((s) => s.schemaDrift)
  const confirmFn = usePipelineStore((s) => s.confirmDrift)
  const haltFn = usePipelineStore((s) => s.haltPipeline)
  const setDrawer = usePipelineStore((s) => s.setDriftDrawerOpen)

  if (!schemaDrift) return null

  return (
    <div className="flex items-center gap-4 px-6 py-2.5 bg-red-50 border-b border-red-200 shrink-0 flex-wrap">
      <div className="flex items-center gap-2 font-bold text-red-700 text-sm shrink-0">
        <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" /> SCHEMA DRIFT DETECTED
      </div>
      <div className="text-red-600 text-xs flex-1 truncate">{schemaDrift.details}</div>
      <div className="flex gap-2 shrink-0">
        <button onClick={() => setDrawer(true)} className="px-3 py-1 bg-white hover:bg-slate-100 border border-slate-300 rounded-lg text-xs text-slate-700 transition-all">View Diff</button>
        <button onClick={confirmFn} className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 rounded-lg text-xs text-white font-medium transition-all">Confirm &amp; Resume</button>
        <button type="button" onClick={() => haltFn()} className="px-3 py-1 border border-red-300 hover:bg-red-100 rounded-lg text-xs text-red-700 transition-all">Abort</button>
      </div>
    </div>
  )
}
