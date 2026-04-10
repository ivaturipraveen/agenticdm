import { useEffect, useState } from 'react'
import { usePipelineStore } from '../store/pipelineStore'
import clsx from 'clsx'

const STAGE_LABEL: Record<string, { label: string; color: string }> = {
  IDLE: { label: 'Ready', color: 'text-slate-500' },
  EXTRACT: { label: 'Extracting', color: 'text-blue-700' },
  TRANSFORM: { label: 'Transforming', color: 'text-violet-700' },
  VALIDATE: { label: 'Validating', color: 'text-amber-700' },
  AWAITING_APPROVAL: { label: 'Awaiting Approval', color: 'text-amber-700' },
  LOAD: { label: 'Loading to FHIR', color: 'text-cyan-700' },
  RECONCILE: { label: 'Reconciling', color: 'text-emerald-700' },
  COMPLETE: { label: 'Complete', color: 'text-emerald-700' },
  HALTED: { label: 'Halted', color: 'text-red-700' },
}

export default function Header() {
  const stage = usePipelineStore((s) => s.stage)
  const runId = usePipelineStore((s) => s.runId)
  const startTime = usePipelineStore((s) => s.startTime)
  const haltFn = usePipelineStore((s) => s.haltPipeline)
  const [clock, setClock] = useState('')
  const [elapsed, setElapsed] = useState(0)
  const [stopping, setStopping] = useState(false)

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

  const handleStop = async () => {
    setStopping(true)
    await haltFn()
    setStopping(false)
  }

  return (
    <header className="flex items-center justify-between px-6 py-3.5 border-b border-slate-200 bg-white shrink-0">
      {/* Logo */}
      <div className="flex items-center gap-3">
        <img
          src="/unnamed.webp"
          alt="Brightcone"
          className="h-9 w-auto max-w-[200px] object-contain object-left"
        />
        <div className="hidden sm:flex sm:items-center sm:min-h-9 border-l border-slate-200 pl-3">
          <div className="text-slate-500 text-base font-medium leading-none whitespace-nowrap">
            Agentic Healthcare Data Migration
          </div>
        </div>
      </div>

      {/* Centre: pipeline stage */}
      <div className="flex items-center gap-3">
        <div className={clsx('flex items-center gap-2 px-4 py-2 rounded-2xl border text-sm font-semibold',
          isRunning ? 'border-blue-200 bg-blue-50' : 'border-slate-200 bg-slate-50'
        )}>
          {isRunning && <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />}
          <span className={stageInfo.color}>{stageInfo.label}</span>
        </div>
        {startTime && (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-mono text-slate-700">
            {fmtElapsed(elapsed)}
          </div>
        )}
        {runId && (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-mono text-slate-500">
            #{runId.slice(-8).toUpperCase()}
          </div>
        )}
        <div className="text-slate-400 text-xs font-mono hidden xl:block">{clock}</div>
      </div>

      {/* Right: stop button or idle state */}
      <div className="flex items-center gap-3">
        {isRunning ? (
          <button
            onClick={handleStop}
            disabled={stopping}
            className="flex items-center gap-2 px-4 py-2 rounded-xl border-2 border-red-300 text-red-700 hover:bg-red-50 font-semibold text-sm transition-all disabled:opacity-50"
          >
            {stopping ? (
              <><span className="w-3 h-3 border-2 border-red-400 border-t-red-700 rounded-full animate-spin" />Stopping…</>
            ) : (
              <><span className="w-2 h-2 rounded-sm bg-red-600 inline-block" />Stop Run</>
            )}
          </button>
        ) : (
          <span className="px-3 py-1.5 rounded-xl border border-slate-200 bg-slate-50 text-slate-500 text-xs font-semibold">
            {stage === 'COMPLETE' ? 'Run Complete' : stage === 'HALTED' ? 'Run Halted' : 'Ready'}
          </span>
        )}
      </div>
    </header>
  )
}
