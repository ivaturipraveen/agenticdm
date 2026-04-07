import { useEffect, useState } from 'react'
import { usePipelineStore } from '../store/pipelineStore'
import clsx from 'clsx'

const STAGE_LABEL: Record<string, { label: string; color: string }> = {
 IDLE: { label: 'Ready', color: 'text-slate-400' },
 EXTRACT: { label: 'Extracting', color: 'text-blue-400' },
 TRANSFORM: { label: 'Transforming', color: 'text-blue-400' },
 VALIDATE: { label: 'Validating', color: 'text-blue-400' },
 AWAITING_APPROVAL: { label: 'Awaiting Approval', color: 'text-amber-400' },
 LOAD: { label: 'Loading to FHIR', color: 'text-blue-400' },
 RECONCILE: { label: 'Reconciling', color: 'text-purple-400' },
 COMPLETE: { label: 'Complete ', color: 'text-emerald-400' },
 HALTED: { label: 'Halted', color: 'text-red-400' },
}

export default function Header() {
 const stage = usePipelineStore((s) => s.stage)
 const runId = usePipelineStore((s) => s.runId)
 const startTime = usePipelineStore((s) => s.startTime)
 const startFn = usePipelineStore((s) => s.startPipeline)
 const resetFn = usePipelineStore((s) => s.resetPipeline)
 const [clock, setClock] = useState('')
 const [elapsed, setElapsed] = useState(0)

 useEffect(() => {
 const id = setInterval(() => {
 setClock(new Date().toUTCString().slice(5, 25) + ' UTC')
 if (startTime) setElapsed(Math.floor((Date.now() - startTime.getTime()) / 1000))
 }, 1000)
 return () => clearInterval(id)
 }, [startTime])

 const stageInfo = STAGE_LABEL[stage] ?? STAGE_LABEL.IDLE
 const isRunning = !['IDLE', 'COMPLETE', 'HALTED'].includes(stage)
 const canStart = ['IDLE', 'COMPLETE', 'HALTED'].includes(stage)

 const fmtElapsed = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`

 return (
 <header className="flex items-center justify-between px-6 py-3 border-b border-slate-800 bg-[#0A0F1E] shrink-0">
 {/* Logo */}
 <div className="flex items-center gap-3">
 <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center shadow-lg shadow-blue-500/30">
 <span className="text-white font-black text-lg">B</span>
 </div>
 <div>
 <div className="text-white font-bold tracking-wide text-base leading-none">BRIGHTCONE</div>
 <div className="text-slate-500 text-[11px] mt-0.5 tracking-wider">AGENTIC MIGRATION PLATFORM</div>
 </div>
 </div>

 {/* Status center */}
 <div className="flex items-center gap-6">
 <div className="flex items-center gap-2">
 {isRunning && <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />}
 <span className={clsx('text-sm font-semibold', stageInfo.color)}>{stageInfo.label}</span>
 </div>
 {startTime && (
 <div className="text-slate-400 font-mono text-xs">{fmtElapsed(elapsed)}</div>
 )}
 {runId && (
 <div className="px-2.5 py-1 bg-slate-800 border border-slate-700 rounded-md text-slate-400 text-xs font-mono">
 #{runId.slice(-8).toUpperCase()}
 </div>
 )}
 </div>

 {/* Actions */}
 <div className="flex items-center gap-3">
 <div className="text-slate-600 text-xs font-mono hidden lg:block">{clock}</div>
 <span className="px-2 py-0.5 rounded bg-amber-500/10 border border-amber-500/20 text-amber-500 text-[10px] font-bold tracking-widest">DEMO</span>
 {!canStart ? null : (
 <>
 {stage !== 'IDLE' && (
 <button onClick={resetFn} className="px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200 border border-slate-700 hover:border-slate-500 rounded-lg transition-all">
 Reset
 </button>
 )}
 <button
 onClick={startFn}
 className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white font-semibold text-sm rounded-lg shadow-lg shadow-blue-500/20 transition-all hover:scale-105 active:scale-95"
 >
 Run Migration
 </button>
 </>
 )}
 {stage === 'AWAITING_APPROVAL' && (
 <div className="px-3 py-1.5 bg-amber-500/10 border border-amber-500/40 rounded-lg text-amber-400 text-xs font-semibold animate-pulse-amber">
 ⏸ Approval Needed
 </div>
 )}
 </div>
 </header>
 )
}
