import { useEffect, useState } from 'react'
import { usePipelineStore } from '../store/pipelineStore'
import clsx from 'clsx'

const STAGE_COLORS: Record<string, string> = {
 IDLE: 'text-slate-400 bg-slate-800',
 EXTRACT: 'text-blue-400 bg-blue-500/10',
 TRANSFORM: 'text-blue-400 bg-blue-500/10',
 VALIDATE: 'text-blue-400 bg-blue-500/10',
 AWAITING_APPROVAL: 'text-amber-400 bg-amber-500/10',
 LOAD: 'text-blue-400 bg-blue-500/10',
 RECONCILE: 'text-blue-400 bg-blue-500/10',
 COMPLETE: 'text-emerald-400 bg-emerald-500/10',
 HALTED: 'text-red-400 bg-red-500/10',
}

function formatElapsed(seconds: number): string {
 const m = Math.floor(seconds / 60).toString().padStart(2, '0')
 const s = (seconds % 60).toString().padStart(2, '0')
 return `${m}:${s}`
}

export default function Footer() {
 const stage = usePipelineStore((s) => s.stage)
 const startTime = usePipelineStore((s) => s.startTime)
 const [elapsed, setElapsed] = useState(0)

 useEffect(() => {
 if (!startTime) { setElapsed(0); return }
 const id = setInterval(() => {
 setElapsed(Math.floor((Date.now() - startTime.getTime()) / 1000))
 }, 1000)
 return () => clearInterval(id)
 }, [startTime])

 return (
 <footer className="flex items-center justify-between px-6 py-2 bg-navy-light border-t border-navy-border text-xs text-slate-400">
 <div className="flex items-center gap-3">
 <span>Status:</span>
 <span className={clsx('px-2 py-0.5 rounded-full font-medium', STAGE_COLORS[stage] || STAGE_COLORS.IDLE)}>
 {stage}
 </span>
 </div>
 <div className="flex items-center gap-4">
 {startTime && (
 <span className="font-mono text-slate-300">
 Runtime: {formatElapsed(elapsed)}
 </span>
 )}
 <span className="px-2 py-0.5 rounded bg-amber-500/10 text-amber-400 font-bold tracking-widest border border-amber-500/20">
 DEMO
 </span>
 </div>
 </footer>
 )
}
