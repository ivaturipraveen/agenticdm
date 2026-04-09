import { useEffect, useState } from 'react'
import { usePipelineStore } from '../store/pipelineStore'
import clsx from 'clsx'

const STAGE_LABEL: Record<string, { label: string; color: string }> = {
 IDLE: { label: 'Ready', color: 'text-slate-600' },
 EXTRACT: { label: 'Extracting', color: 'text-blue-600' },
 TRANSFORM: { label: 'Transforming', color: 'text-violet-600' },
 VALIDATE: { label: 'Validating', color: 'text-amber-600' },
 AWAITING_APPROVAL: { label: 'Awaiting Approval', color: 'text-amber-600' },
 LOAD: { label: 'Loading to FHIR', color: 'text-cyan-600' },
 RECONCILE: { label: 'Reconciling', color: 'text-emerald-600' },
 COMPLETE: { label: 'Complete', color: 'text-emerald-600' },
 HALTED: { label: 'Halted', color: 'text-red-600' },
}

export default function Header() {
 const stage = usePipelineStore((s) => s.stage)
 const runId = usePipelineStore((s) => s.runId)
 const startTime = usePipelineStore((s) => s.startTime)
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
 const fmtElapsed = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`

 return (
 <header className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-white shrink-0">
 <div className="flex items-center gap-4">
 <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-blue-600 to-blue-700 flex items-center justify-center shadow-sm">
 <span className="text-white font-black text-lg">B</span>
 </div>
 <div>
 <div className="text-slate-900 font-bold tracking-wide text-lg leading-none">Brightcone Migration Platform</div>
 <div className="text-slate-500 text-xs mt-1 tracking-wide">PostgreSQL to FHIR R4 orchestration</div>
 </div>
 </div>

 <div className="flex items-center gap-3">
 <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2 text-right min-w-[150px]">
 <div className={clsx('text-sm font-semibold', stageInfo.color)}>{stageInfo.label}</div>
 <div className="text-[11px] text-slate-500 mt-0.5">Current pipeline stage</div>
 </div>
 {startTime && <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2 text-right min-w-[90px]"><div className="text-sm font-mono text-slate-800">{fmtElapsed(elapsed)}</div><div className="text-[11px] text-slate-500 mt-0.5">elapsed</div></div>}
 {runId && <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2 text-right min-w-[110px]"><div className="text-sm font-mono text-slate-800">#{runId.slice(-8).toUpperCase()}</div><div className="text-[11px] text-slate-500 mt-0.5">run id</div></div>}
 <div className="text-slate-500 text-xs font-mono hidden xl:block">{clock}</div>
 {isRunning && <div className="px-3 py-2 rounded-2xl bg-blue-50 border border-blue-200 text-blue-700 text-xs font-semibold">Pipeline Active</div>}
 </div>
 </header>
 )
}
