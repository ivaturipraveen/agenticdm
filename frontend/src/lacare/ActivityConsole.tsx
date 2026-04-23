import { useEffect, useState } from 'react'
import { LaCareActivity, getActivity } from './api'

interface Props {
  open: boolean
  onClose: () => void
}

const STATUS_COLOR = (code: number) => {
  if (code >= 500) return 'text-red-400'
  if (code >= 400) return 'text-amber-300'
  if (code >= 300) return 'text-cyan-300'
  return 'text-emerald-300'
}

export default function ActivityConsole({ open, onClose }: Props) {
  const [items, setItems] = useState<LaCareActivity[]>([])

  useEffect(() => {
    if (!open) return
    let stop = false
    const tick = async () => {
      try {
        const res = await getActivity(150)
        if (!stop) setItems(res.items)
      } catch {
        /* noop */
      }
    }
    void tick()
    const id = window.setInterval(tick, 1800)
    return () => { stop = true; window.clearInterval(id) }
  }, [open])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="flex-1 bg-black/40" onClick={onClose} />
      <aside className="w-full max-w-[640px] bg-slate-950 text-slate-100 flex flex-col border-l border-slate-800 shadow-2xl">
        <header className="flex items-center justify-between px-5 py-3.5 border-b border-slate-800 bg-slate-900">
          <div>
            <div className="text-[10px] font-bold tracking-[0.2em] uppercase text-rose-400">
              LIVE · System Activity
            </div>
            <h2 className="text-sm font-semibold">Platform request + pipeline tail</h2>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-100 text-xl leading-none px-2">×</button>
        </header>

        <div className="flex-1 overflow-auto font-mono text-[12px] p-4 space-y-0.5 bg-slate-950">
          {items.length === 0 && (
            <div className="text-slate-500">Waiting for activity…</div>
          )}
          {items.map((a, i) => (
            <div key={i} className="flex gap-3 whitespace-nowrap">
              <span className="text-slate-500">
                {new Date(a.ts).toLocaleTimeString()}
              </span>
              {a.kind === 'http' ? (
                <>
                  <span className="text-violet-300 uppercase w-[46px]">{a.method}</span>
                  <span className={`w-[46px] font-bold ${STATUS_COLOR(a.status)}`}>{a.status}</span>
                  <span className="text-slate-300 truncate">{a.path}</span>
                  <span className="text-slate-500 ml-auto">
                    {a.duration_ms}ms {a.actor && <span className="text-slate-400">· {a.actor}</span>}
                  </span>
                </>
              ) : (
                <>
                  <span className="text-amber-300 uppercase w-[46px]">{a.kind}</span>
                  <span className="text-slate-200">{a.message}</span>
                </>
              )}
            </div>
          ))}
        </div>

        <footer className="px-5 py-2.5 border-t border-slate-800 bg-slate-900 text-[10px] text-slate-500 uppercase tracking-widest font-bold">
          polling every 1.8s · last {items.length} events
        </footer>
      </aside>
    </div>
  )
}
