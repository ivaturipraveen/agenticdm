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
import TargetHealthPage from './components/TargetHealthPage'
import MockAdminPage from './components/MockAdminPage'

type TopTab = 'home' | 'run' | 'history' | 'endpoint' | 'target' | 'mock'

export default function App() {
  useWebSocket()
  const stage = usePipelineStore((s) => s.stage)
  const approvalGate = usePipelineStore((s) => s.approvalGate)
  const runs = usePipelineStore((s) => s.runs)
  const resetFn = usePipelineStore((s) => s.resetPipeline)
  const [tab, setTab] = useState<TopTab>('home')

  const isRunning = !['IDLE', 'COMPLETE', 'HALTED'].includes(stage)
  const isActive = stage !== 'IDLE'

  // Auto-switch to run tab only when pipeline starts (not when complete/halted)
  useEffect(() => {
    if (isRunning) setTab('run')
  }, [isRunning])

  // When run completes or halts, go back to home
  useEffect(() => {
    if (stage === 'COMPLETE' || stage === 'HALTED') {
      setTab('home')
    }
  }, [stage])

  const completedRuns = runs.filter(r => r.status === 'complete').length

  const TABS = [
    { id: 'home' as const, label: 'Home' },
    ...(isActive ? [{ id: 'run' as const, label: 'Active Run', badge: isRunning ? '●' : null }] : []),
    { id: 'history' as const, label: 'Run History', badge: completedRuns > 0 ? String(completedRuns) : null },
    { id: 'endpoint' as const, label: 'FHIR Endpoint' },
    { id: 'target' as const, label: 'Target' },
    { id: 'mock' as const, label: 'Mock Controls' },
  ]

  return (
    <div className="h-screen flex flex-col bg-slate-100 overflow-hidden text-slate-900">
      <Toaster position="top-right" toastOptions={{
        style: { background: '#ffffff', color: '#0f172a', border: '1px solid #cbd5e1', fontSize: '13px', borderRadius: '12px' },
        duration: 4000,
      }} />
      <Header />
      <SchemaDriftBanner />
      {isActive && tab === 'run' && <PipelineStepper />}

      {/* Tab bar */}
      <div className="flex items-center gap-1 px-6 border-b border-slate-200 shrink-0 bg-white overflow-x-auto">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-all whitespace-nowrap ${tab === t.id ? 'border-blue-600 text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'}`}
          >
            {t.label}
            {t.badge && (
              <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${t.badge === '●' ? 'bg-blue-100 text-blue-700' : 'bg-slate-200 text-slate-700'}`}>
                {t.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      <main className="flex-1 overflow-hidden min-h-0 bg-slate-100">
        {tab === 'home' && <PreMigrationView onStartRun={() => setTab('run')} />}
        {tab === 'run' && (
          isActive
            ? <MigrationView onGoHome={() => { resetFn(); setTab('home') }} />
            : <PreMigrationView onStartRun={() => setTab('run')} />
        )}
        {tab === 'history' && <div className="h-full p-4 overflow-hidden"><RunHistory /></div>}
        {tab === 'endpoint' && <FhirDataPage />}
        {tab === 'target' && <TargetHealthPage />}
        {tab === 'mock' && <MockAdminPage />}
      </main>

      {approvalGate && <ApprovalModal />}
      <SchemaDriftDrawer />
    </div>
  )
}
