import { useEffect, useState } from 'react'
import { apiUrl } from '../api/client'

export default function TargetHealthPage() {
  const [health, setHealth] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  const load = () => {
    setLoading(true)
    fetch(apiUrl('/api/target/health')).then(r => r.json()).then(d => { setHealth(d); setLoading(false) }).catch(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  return (
    <div className="h-full overflow-y-auto p-4 bg-slate-100">
      <div className="rounded-3xl border border-slate-200 bg-white overflow-hidden shadow-sm">
        <div className="px-6 py-5 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
          <div>
            <div className="text-slate-900 font-bold text-xl">Target Verification</div>
            <div className="text-slate-500 text-sm mt-1">Checks whether the configured FHIR target endpoint is reachable.</div>
          </div>
          <button onClick={load} className="px-3 py-1.5 rounded-xl border border-slate-300 text-slate-700 hover:bg-slate-100 text-sm bg-white">Refresh</button>
        </div>
        <div className="p-6 bg-slate-50/50">
          {loading ? <div className="text-slate-500">Checking target endpoint...</div> : !health ? <div className="text-slate-500">Unable to read target status.</div> : <div className="grid grid-cols-3 gap-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className="text-xs text-slate-500 uppercase tracking-wider">Reachable</div><div className={`text-2xl font-bold mt-2 ${health.reachable ? 'text-emerald-700' : 'text-red-700'}`}>{health.reachable ? 'Yes' : 'No'}</div></div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className="text-xs text-slate-500 uppercase tracking-wider">Status Code</div><div className="text-2xl font-bold mt-2 text-slate-900">{health.status_code ?? '—'}</div></div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className="text-xs text-slate-500 uppercase tracking-wider">Target URL</div><div className="text-sm font-mono mt-2 text-slate-700 break-all">{health.target}</div></div>
          </div>}
        </div>
      </div>
    </div>
  )
}
