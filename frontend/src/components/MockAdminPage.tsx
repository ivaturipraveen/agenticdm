export default function MockAdminPage() {
  const trigger = async () => { await fetch('/api/mock/schema-drift/trigger', { method: 'POST' }) }
  const clear = async () => { await fetch('/api/mock/schema-drift/clear', { method: 'POST' }) }

  return (
    <div className="h-full overflow-y-auto p-4 bg-slate-100">
      <div className="rounded-3xl border border-slate-200 bg-white overflow-hidden shadow-sm">
        <div className="px-6 py-5 border-b border-slate-200 bg-slate-50">
          <div className="text-slate-900 font-bold text-xl">Schema Drift Trigger</div>
          <div className="text-slate-500 text-sm mt-1">Use this to simulate upstream schema change during a live run.</div>
        </div>
        <div className="p-6 space-y-4 bg-slate-50/50">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-700 leading-relaxed shadow-sm">Triggering schema drift adds a temporary column to the claims table so the Integration Monitor Agent can detect a source schema change. Clear removes the change after the demo moment.</div>
          <div className="flex items-center gap-3">
            <button onClick={trigger} className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-semibold text-sm">Trigger Drift</button>
            <button onClick={clear} className="px-4 py-2 rounded-xl border border-slate-300 text-slate-700 hover:bg-slate-100 text-sm bg-white">Clear Drift</button>
          </div>
        </div>
      </div>
    </div>
  )
}
