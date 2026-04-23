import { useEffect, useState } from 'react'
import { LaCareStatus } from './api'

/**
 * Sticky, unambiguous pipeline-state strip rendered directly beneath the
 * app header. Replaces the "am I running or not?" confusion the client
 * asked about. Shows:
 *   - IDLE (grey)
 *   - QUEUED (blue, spinner)
 *   - RUNNING — current stage X/6, n/N documents, elapsed timer, progress bar
 *   - COMPLETE — total docs + evidence count + total duration
 *   - FAILED / HALTED — red
 */

interface Props {
  status: LaCareStatus | null
  gapsClosed?: number
  onCancel?: () => void
  canceling?: boolean
}

const STAGE_ORDER = ['ingest', 'extraction', 'normalization', 'nlp', 'hedis', 'dashboard']
const STAGE_LABEL: Record<string, string> = {
  idle: 'Idle',
  ingest: 'Ingest',
  extraction: 'Extraction',
  normalization: 'Normalization',
  nlp: 'Narrative NLP',
  hedis: 'HEDIS matching',
  dashboard: 'Dashboard rollup',
  complete: 'Complete',
  failed: 'Failed',
}

function formatElapsed(ms: number) {
  if (ms <= 0) return '00:00'
  const s = Math.floor(ms / 1000)
  const mm = String(Math.floor(s / 60)).padStart(2, '0')
  const ss = String(s % 60).padStart(2, '0')
  return `${mm}:${ss}`
}

export default function PipelineStatusBanner({ status, gapsClosed = 0, onCancel, canceling }: Props) {
  const [now, setNow] = useState(() => Date.now())

  const isLive = status?.status === 'running' || status?.status === 'queued'

  useEffect(() => {
    if (!isLive) return
    const h = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(h)
  }, [isLive])

  if (!status || !status.run_id) {
    return (
      <div className="px-6 py-2.5 border-b border-slate-200 bg-slate-50 text-xs text-slate-500 flex items-center gap-2">
        <span className="h-2 w-2 rounded-full bg-slate-300" />
        No active run. Pick samples from the Sample Library to start.
      </div>
    )
  }

  const elapsed = (() => {
    if (!status.started_at) return 0
    const started = Date.parse(status.started_at)
    if (!Number.isFinite(started)) return 0
    const end = status.completed_at ? Date.parse(status.completed_at) : now
    return Math.max(0, end - started)
  })()

  const total = status.total_documents || 0
  const processed = status.processed_documents || 0
  const pct = total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0
  const stage = (status.current_stage || '').toLowerCase()
  const stageIdx = STAGE_ORDER.indexOf(stage)
  const stagePos = stageIdx >= 0 ? stageIdx + 1 : stage === 'complete' ? 6 : 0

  if (status.status === 'complete') {
    const hits = Object.values(status.measure_counts || {}).reduce((a, b) => a + (b as number), 0)
    return (
      <div className="px-6 py-3 border-b border-emerald-200 bg-emerald-50 flex items-center gap-4 text-sm">
        <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
        <div className="font-semibold text-emerald-900">Pipeline complete</div>
        <div className="text-emerald-800/90 text-xs">
          <b>{total}</b> documents · <b>{hits}</b> HEDIS hits · <b>{gapsClosed}</b> gaps closed · total duration <b>{formatElapsed(elapsed)}</b>
        </div>
        <div className="ml-auto text-[11px] text-emerald-700 font-mono">run {status.run_id.slice(0, 8)}</div>
      </div>
    )
  }

  if (status.status === 'failed' || status.status === 'halted') {
    return (
      <div className="px-6 py-3 border-b border-red-200 bg-red-50 flex items-center gap-3 text-sm">
        <span className="h-2.5 w-2.5 rounded-full bg-red-500" />
        <div className="font-semibold text-red-900">Pipeline {status.status}</div>
        <div className="text-red-800/90 text-xs">stage: {STAGE_LABEL[stage] || stage}</div>
        <div className="ml-auto text-[11px] text-red-700 font-mono">run {status.run_id.slice(0, 8)}</div>
      </div>
    )
  }

  // running / queued
  return (
    <div className="border-b border-rose-200 bg-gradient-to-r from-rose-50 via-white to-rose-50">
      <div className="px-6 py-2.5 flex items-center gap-4 text-sm">
        <span className="relative flex h-2.5 w-2.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-rose-600" />
        </span>
        <div className="font-semibold text-rose-900">
          Pipeline running
        </div>
        <div className="text-xs text-slate-700">
          Stage {stagePos || '—'}/6 · <b>{STAGE_LABEL[stage] || stage}</b>
        </div>
        <div className="text-xs text-slate-700">
          <b>{processed}</b> / {total} documents
        </div>
        <div className="text-xs text-slate-700">
          elapsed <span className="font-mono tabular-nums">{formatElapsed(elapsed)}</span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <div className="w-48 h-2 rounded-full bg-rose-100 overflow-hidden">
            <div
              className="h-full bg-rose-600 transition-all duration-500"
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="text-[11px] font-mono text-rose-800 w-10 text-right">{pct}%</span>
          {onCancel && (
            <button
              onClick={onCancel}
              disabled={canceling}
              className="ml-2 px-3 py-1 rounded-md text-[11px] font-semibold border border-red-300 text-red-700 bg-white hover:bg-red-50 disabled:opacity-60 disabled:cursor-not-allowed"
              title="Cancel this pipeline run"
            >
              {canceling ? 'Cancelling…' : '■ Cancel run'}
            </button>
          )}
        </div>
      </div>
      {/* Agent ribbon — visually shows which agent is active right now */}
      <div className="px-6 pb-2 flex items-center gap-1.5 overflow-x-auto">
        {STAGE_ORDER.map((st, i) => {
          const a = status.agents?.[st]
          const s = a?.status || 'idle'
          const active = st === stage
          const done = s === 'complete'
          const fail = s === 'failed'
          const bg = fail
            ? 'bg-red-100 text-red-800 border-red-300'
            : done
              ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
              : active
                ? 'bg-rose-600 text-white border-rose-600 shadow-sm'
                : 'bg-white text-slate-500 border-slate-200'
          return (
            <div key={st} className={`text-[10px] px-2 py-1 rounded-md border font-semibold uppercase tracking-wider whitespace-nowrap ${bg}`} title={a?.last_action || ''}>
              {i + 1}. {STAGE_LABEL[st]}
              {a?.processed ? <span className="ml-1 font-mono opacity-80">({a.processed})</span> : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}
