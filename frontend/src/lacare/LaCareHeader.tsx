import { LaCareStatus } from './api'

interface Props {
  status: LaCareStatus | null
  onExitToLauncher?: () => void
  userLabel?: string
  onOpenActivity?: () => void
}

export default function LaCareHeader({ status, onExitToLauncher, userLabel, onOpenActivity }: Props) {
  const state = status?.status ?? 'idle'
  const indicatorColor =
    state === 'running' ? 'bg-rose-500' :
    state === 'complete' ? 'bg-emerald-500' :
    state === 'failed' ? 'bg-red-500' :
    'bg-slate-400'

  const indicatorLabel =
    state === 'running' ? 'Processing CCDA batch' :
    state === 'complete' ? 'Run complete' :
    state === 'failed' ? 'Run failed' :
    state === 'halted' ? 'Halted' :
    'Idle'

  const runBadge = status?.run_id ? `#${status.run_id.slice(0, 8).toUpperCase()}` : null

  return (
    <header className="flex items-center justify-between px-6 py-3.5 border-b border-slate-200 bg-white shrink-0">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-3">
          <img src="/unnamed.webp" alt="Brightcone" className="h-9 w-auto max-w-[160px] object-contain" />
          <div className="h-8 w-px bg-slate-200" />
          <div>
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-rose-600">
              <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-rose-50">
                <span className="h-2 w-2 rounded-full bg-rose-500" />
              </span>
              LA Care Health Plan
            </div>
            <div className="text-slate-900 text-[15px] font-semibold leading-tight whitespace-nowrap">
              CCDA Clinical Document Intelligence
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className={`flex items-center gap-2 px-4 py-2 rounded-2xl border text-sm font-semibold
          ${state === 'running' ? 'border-rose-200 bg-rose-50 text-rose-700' :
            state === 'complete' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' :
            'border-slate-200 bg-slate-50 text-slate-600'}`}>
          <span className={`w-2 h-2 rounded-full ${indicatorColor} ${state === 'running' ? 'animate-pulse' : ''}`} />
          {indicatorLabel}
        </div>
        {status && status.total_documents > 0 && (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-mono text-slate-600">
            {status.processed_documents}/{status.total_documents} docs
          </div>
        )}
        {runBadge && (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-mono text-slate-500">
            {runBadge}
          </div>
        )}
      </div>

      <div className="flex items-center gap-3 text-xs">
        {onOpenActivity && (
          <button
            onClick={onOpenActivity}
            className="px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 font-medium"
            title="Show live system activity"
          >
            System Activity
          </button>
        )}
        {userLabel && (
          <span className="text-slate-500 hidden md:block">
            Signed in as <span className="font-semibold text-slate-700">{userLabel}</span>
          </span>
        )}
        {onExitToLauncher && (
          <button onClick={onExitToLauncher} className="px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 font-medium">
            Switch App
          </button>
        )}
      </div>
    </header>
  )
}
