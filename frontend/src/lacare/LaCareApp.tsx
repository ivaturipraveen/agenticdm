import { useEffect, useRef, useState } from 'react'
import toast, { Toaster } from 'react-hot-toast'
import {
  getDashboard, getDocuments, getEvidence, getStatus, startPipeline, resetPipeline,
  listRuns, runFromSamples, getActiveRun, cancelPipeline,
  LaCareDashboard, LaCareDocument, LaCareHit, LaCareStatus, LaCareRun, LaCareActiveRun,
} from './api'
import OverviewTab from './tabs/OverviewTab'
import PipelineTab from './tabs/PipelineTab'
import EvidenceTab from './tabs/EvidenceTab'
import DocumentsTab from './tabs/DocumentsTab'
import BeforeAfterTab from './tabs/BeforeAfterTab'
import SampleLibraryTab from './tabs/SampleLibraryTab'
import LaCareHeader from './LaCareHeader'
import ActivityConsole from './ActivityConsole'
import PipelineStatusBanner from './PipelineStatusBanner'
import TutorialModal, { useFirstRunTutorial } from './TutorialModal'

type Tab = 'overview' | 'library' | 'pipeline' | 'evidence' | 'documents' | 'beforeafter'

interface Props {
  onExitToLauncher?: () => void
  userLabel?: string
}

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'library', label: 'Sample Library' },
  { id: 'pipeline', label: 'Agentic Pipeline' },
  { id: 'evidence', label: 'HEDIS Evidence' },
  { id: 'documents', label: 'Documents' },
  { id: 'beforeafter', label: 'Raw vs Extracted' },
]

export default function LaCareApp({ onExitToLauncher, userLabel }: Props) {
  const [tab, setTab] = useState<Tab>('overview')
  const [runId, setRunId] = useState<string | null>(null)
  const [runs, setRuns] = useState<LaCareRun[]>([])
  const [status, setStatus] = useState<LaCareStatus | null>(null)
  const [dashboard, setDashboard] = useState<LaCareDashboard | null>(null)
  const [documents, setDocuments] = useState<LaCareDocument[]>([])
  const [evidence, setEvidence] = useState<LaCareHit[]>([])
  const [activeRun, setActiveRun] = useState<LaCareActiveRun | null>(null)
  const [activityOpen, setActivityOpen] = useState(false)
  const [canceling, setCanceling] = useState(false)
  const [tutorialOpen, setTutorialOpen] = useFirstRunTutorial()
  const pollRef = useRef<number | null>(null)

  const refreshAll = async (rid?: string | null) => {
    const activeId = rid ?? runId ?? undefined
    try {
      const [s, d, docs, ev, rs, ar] = await Promise.all([
        getStatus(activeId),
        getDashboard(activeId),
        getDocuments({ run_id: activeId, limit: 500 }),
        getEvidence({ run_id: activeId, limit: 500 }),
        listRuns(),
        getActiveRun(),
      ])
      setStatus(s)
      setDashboard(d)
      setDocuments(docs.items)
      setEvidence(ev.items)
      setRuns(rs.items)
      setActiveRun(ar)
      if (!runId && s.run_id) setRunId(s.run_id)
    } catch {
      /* ignore — UI falls back to empty states */
    }
  }

  useEffect(() => {
    refreshAll()
     
  }, [])

  useEffect(() => {
    if (pollRef.current) window.clearInterval(pollRef.current)
    const isLive = status?.status === 'running' || status?.status === 'queued' || activeRun?.active
    if (isLive) {
      // Poll every ~2.5s and skip while tab is hidden to stop the
      // log flood the client flagged.
      pollRef.current = window.setInterval(() => {
        if (document.visibilityState === 'hidden') return
        refreshAll()
      }, 2500)
    } else {
      // Idle heartbeat — one refresh every 15s just to notice new runs.
      pollRef.current = window.setInterval(() => {
        if (document.visibilityState === 'hidden') return
        refreshAll()
      }, 15000)
    }
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current)
    }
     
  }, [status?.status, activeRun?.active, runId])

  const showLockError = (err: any, fallback: string) => {
    const detail = err?.response?.data?.detail
    if (err?.response?.status === 409 && detail?.active_run_id) {
      toast.error(
        `A pipeline run is already in progress (${String(detail.active_run_id).slice(0, 8)}). Wait for it to finish.`,
        { duration: 5000 },
      )
      setActiveRun({ active: true, run: { run_id: detail.active_run_id, status: detail.active_status ?? 'running' } as any })
      return
    }
    toast.error(typeof detail === 'string' ? detail : (detail?.message || fallback))
  }

  const run = async (useAi: boolean) => {
    if (!runId) {
      toast.error('Pick samples from the Sample Library to create a run first.')
      return
    }
    if (activeRun?.active && activeRun.run?.run_id !== runId) {
      toast.error('Another run is still processing. Please wait for it to complete.')
      return
    }
    try {
      await startPipeline(runId, useAi)
      toast.success(useAi ? 'Pipeline started with narrative NLP' : 'Pipeline started (heuristic NLP)')
      setTab('pipeline')
      await refreshAll()
    } catch (err: any) {
      showLockError(err, 'Could not start pipeline')
    }
  }

  const runOnSamples = async (sampleIds: string[], useAi: boolean) => {
    const toastId = toast.loading(`Creating run from ${sampleIds.length} samples…`)
    try {
      const res = await runFromSamples(sampleIds, { use_ai: useAi, auto_start: true })
      toast.success(`Run started — ${res.inserted} documents in flight`, { id: toastId })
      setRunId(res.run_id)
      setTab('pipeline')
      await refreshAll(res.run_id)
    } catch (err: any) {
      toast.dismiss(toastId)
      showLockError(err, 'Could not start run from samples')
    }
  }

  const doReset = async () => {
    if (!runId) return
    if (!confirm('Delete this run and all its documents + evidence?')) return
    try {
      await resetPipeline(runId)
      setRunId(null)
      toast.success('Run cleared')
      await refreshAll(null)
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Reset failed')
    }
  }

  const doCancel = async () => {
    // Cancel whichever run is currently active, even if the user has
    // switched the dropdown to a different (already-complete) run.
    const target = activeRun?.run?.run_id || runId || undefined
    if (!confirm('Cancel the currently running pipeline?')) return
    setCanceling(true)
    const toastId = toast.loading('Cancelling pipeline…')
    try {
      const res = await cancelPipeline(target)
      if (res.status === 'no_active_run') {
        toast.success('No active run to cancel', { id: toastId })
      } else {
        toast.success(`Run ${res.run_id.slice(0, 8)} halted`, { id: toastId })
      }
      await refreshAll(runId)
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Cancel failed', { id: toastId })
    } finally {
      setCanceling(false)
    }
  }

  const switchRun = async (rid: string) => {
    setRunId(rid)
    await refreshAll(rid)
  }

  const isRunning = status?.status === 'running' || status?.status === 'queued'

  return (
    <div className="h-screen flex flex-col bg-slate-50 overflow-hidden text-slate-900">
      <Toaster position="top-right" />
      <LaCareHeader
        status={status}
        onExitToLauncher={onExitToLauncher}
        userLabel={userLabel}
        onOpenActivity={() => setActivityOpen(true)}
        onOpenTutorial={() => setTutorialOpen(true)}
      />

      <TutorialModal open={tutorialOpen} onClose={() => setTutorialOpen(false)} />

      <PipelineStatusBanner
        status={status}
        gapsClosed={status?.gaps_closed || 0}
        onCancel={isRunning || activeRun?.active ? doCancel : undefined}
        canceling={canceling}
      />

      <nav className="flex items-center gap-1 px-6 border-b border-slate-200 bg-white shrink-0">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-5 py-3.5 text-sm font-medium border-b-2 transition-all whitespace-nowrap
              ${tab === t.id ? 'border-rose-600 text-rose-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}
          >
            <div className="flex items-center gap-2">
              {t.label}
              {t.id === 'pipeline' && isRunning && (
                <span className="px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 text-[10px] font-bold animate-pulse">Live</span>
              )}
            </div>
          </button>
        ))}
        <div className="ml-auto flex items-center gap-3 pr-2 text-xs">
          {activeRun?.active && (
            <span className="px-2.5 py-1 rounded-full bg-amber-50 border border-amber-200 text-amber-800 text-[10px] font-bold uppercase tracking-widest animate-pulse">
              Pipeline locked
            </span>
          )}
          {runs.length > 0 && (
            <label className="flex items-center gap-2" title="Every time you click Run pipeline a new Run is created. Use this to switch between past runs and see their documents / evidence.">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Viewing run</span>
              <select
                value={runId ?? ''}
                onChange={(e) => switchRun(e.target.value)}
                className="px-2 py-1 rounded-md border border-slate-200 bg-white text-slate-700 max-w-[280px]"
              >
                <option value="" disabled>— switch run —</option>
                {runs.slice(0, 20).map(r => (
                  <option key={r.run_id} value={r.run_id}>
                    {new Date(r.started_at).toLocaleString()} · {r.total_documents} docs · {r.status}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </nav>

      <main className="flex-1 overflow-auto min-h-0">
        {tab === 'overview' && (
          <OverviewTab
            dashboard={dashboard}
            status={status}
            runId={runId}
            isRunning={isRunning || !!activeRun?.active}
            onGoToLibrary={() => setTab('library')}
          />
        )}
        {tab === 'library' && (
          <SampleLibraryTab
            activeRunInfo={activeRun ? { active: activeRun.active, run_id: activeRun.run?.run_id } : null}
            onRunFromSamples={runOnSamples}
          />
        )}
        {tab === 'pipeline' && (
          <PipelineTab
            status={status}
            onRunPipeline={() => run(true)}
            onReset={doReset}
            onCancel={isRunning || activeRun?.active ? doCancel : undefined}
            canceling={canceling}
          />
        )}
        {tab === 'evidence' && (
          <EvidenceTab
            evidence={evidence}
            dashboard={dashboard}
          />
        )}
        {tab === 'documents' && (
          <DocumentsTab
            documents={documents}
            evidence={evidence}
            runId={runId}
          />
        )}
        {tab === 'beforeafter' && (
          <BeforeAfterTab />
        )}
      </main>

      <ActivityConsole open={activityOpen} onClose={() => setActivityOpen(false)} />
    </div>
  )
}
