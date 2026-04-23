export default function MockAdminPage() {
  return (
    <div className="h-full overflow-y-auto p-4 bg-slate-100">
      <div className="rounded-3xl border border-slate-200 bg-white overflow-hidden shadow-sm">
        <div className="px-6 py-5 border-b border-slate-200 bg-slate-50">
          <div className="text-slate-900 font-bold text-xl">Schema Monitor</div>
          <div className="text-slate-500 text-sm mt-1">The Integration Monitor Agent checks for schema drift automatically every 30 seconds.</div>
        </div>
        <div className="p-6 bg-slate-50/50">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-700 leading-relaxed shadow-sm">
            Schema drift detection is active. Any column added or removed in the source database will be automatically detected and the pipeline will be halted for review.
          </div>
        </div>
      </div>
    </div>
  )
}
