import { useState, useEffect } from 'react'
import { Toaster } from 'react-hot-toast'
import { usePipelineStore } from './store/pipelineStore'
import { useWebSocket } from './hooks/useWebSocket'
import Header from './components/Header'
import PipelineStepper from './components/PipelineStepper'
import ApprovalModal from './components/ApprovalModal'
import SchemaDriftBanner from './components/SchemaDriftBanner'
import SchemaDriftDrawer from './components/SchemaDriftDrawer'
import PreMigrationView from './components/PreMigrationView'
import MigrationView from './components/MigrationView'
import RunHistory from './components/RunHistory'
import FhirDataPage from './components/FhirDataPage'

type TopTab = 'home' | 'run' | 'history' | 'endpoint'

interface AgenticAppProps {
  onExitToLauncher?: () => void
  userLabel?: string
}

export default function AgenticApp({ onExitToLauncher, userLabel }: AgenticAppProps) {
  useWebSocket()
  const stage = usePipelineStore((s) => s.stage)
  const approvalGate = usePipelineStore((s) => s.approvalGate)
  const runs = usePipelineStore((s) => s.runs)
  const resetFn = usePipelineStore((s) => s.resetPipeline)
  const [tab, setTab] = useState<TopTab>('home')

  const isRunning = !['IDLE', 'COMPLETE', 'HALTED'].includes(stage)
  const isActive = stage !== 'IDLE'

  useEffect(() => {
    if (isRunning) setTab('run')
  }, [isRunning])

  useEffect(() => {
    if (approvalGate) setTab('run')
  }, [approvalGate])

  useEffect(() => {
    if (stage === 'COMPLETE' || stage === 'HALTED') {
      const timer = setTimeout(() => setTab('home'), 400)
      return () => clearTimeout(timer)
    }
  }, [stage])

  const completedRuns = runs.filter(r => r.status === 'complete').length

  const TABS: { id: TopTab; label: string; badge?: string | null }[] = [
    { id: 'home', label: 'Home' },
    ...(isActive ? [{ id: 'run' as TopTab, label: 'Active Run', badge: isRunning ? 'Live' : null }] : []),
    { id: 'history', label: 'Run History', badge: completedRuns > 0 ? String(completedRuns) : null },
    { id: 'endpoint', label: 'FHIR Endpoint' },
  ]

  return (
    <div className="h-screen flex flex-col bg-slate-50 overflow-hidden text-slate-900">
      <Toaster
        position="top-right"
        toastOptions={{
          style: { background: '#ffffff', color: '#0f172a', border: '1px solid #e2e8f0', fontSize: '13px', borderRadius: '12px', boxShadow: '0 4px 24px rgba(0,0,0,0.08)' },
          duration: 4000,
        }}
      />
      <Header />
      <SchemaDriftBanner />
      {isActive && tab === 'run' && <PipelineStepper />}

      <div className="flex items-center justify-between px-6 border-b border-slate-200 shrink-0 bg-white">
        <div className="flex items-center">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-2 px-5 py-3.5 text-sm font-medium border-b-2 transition-all whitespace-nowrap ${tab === t.id ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}
            >
              {t.label}
              {t.badge && (
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${t.badge === 'Live' ? 'bg-blue-100 text-blue-700 animate-pulse' : 'bg-slate-100 text-slate-600'}`}>
                  {t.badge}
                </span>
              )}
            </button>
          ))}
        </div>
        {onExitToLauncher && (
          <div className="flex items-center gap-3 text-xs">
            {userLabel && <span className="text-slate-500">Signed in as <span className="font-semibold text-slate-700">{userLabel}</span></span>}
            <button onClick={onExitToLauncher} className="px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 font-medium">Switch App</button>
          </div>
        )}
      </div>

      <main className="flex-1 overflow-hidden min-h-0">
        {tab === 'home' && <PreMigrationView onStartRun={() => setTab('run')} />}
        {tab === 'run' && (
          isActive
            ? <MigrationView onGoHome={() => { resetFn(); setTab('home') }} />
            : <PreMigrationView onStartRun={() => setTab('run')} />
        )}
        {tab === 'history' && <div className="h-full p-4 overflow-hidden"><RunHistory /></div>}
        {tab === 'endpoint' && <FhirDataPage />}
      </main>

      {approvalGate && <ApprovalModal />}
      <SchemaDriftDrawer />
    </div>
  )
}
