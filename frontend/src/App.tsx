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

type TopTab = 'migrate' | 'history' | 'fhir' | 'target' | 'mock'

export default function App() {
 useWebSocket()
 const stage = usePipelineStore((s) => s.stage)
 const approvalGate = usePipelineStore((s) => s.approvalGate)
 const runs = usePipelineStore((s) => s.runs)
 const [tab, setTab] = useState<TopTab>('migrate')

 const isActive = stage !== 'IDLE'
 const isRunning = !['IDLE', 'COMPLETE', 'HALTED'].includes(stage)

 useEffect(() => {
 if (isRunning) setTab('migrate')
 }, [isRunning])

 const completedRuns = runs.filter(r => r.status === 'complete').length

 return (
 <div className="h-screen flex flex-col bg-slate-100 overflow-hidden text-slate-900">
 <Toaster position="top-right" toastOptions={{ style: { background: '#ffffff', color: '#0f172a', border: '1px solid #cbd5e1', fontSize: '13px', borderRadius: '12px' }, duration: 4000 }} />
 <Header />
 <SchemaDriftBanner />
 {isActive && tab === 'migrate' && <PipelineStepper />}

 <div className="flex items-center gap-1 px-6 border-b border-slate-200 shrink-0 bg-white overflow-x-auto">
 {[
 { id: 'migrate' as const, label: 'Migration' },
 { id: 'history' as const, label: 'Run History', badge: completedRuns > 0 ? String(completedRuns) : null },
 { id: 'fhir' as const, label: 'FHIR Registry' },
 { id: 'target' as const, label: 'Target' },
 { id: 'mock' as const, label: 'Mock Controls' },
 ].map(t => (
 <button key={t.id} onClick={() => setTab(t.id)} className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-all whitespace-nowrap ${tab === t.id ? 'border-blue-600 text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'}`}>
 {t.label}
 {'badge' in t && t.badge && <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-200 text-slate-700">{t.badge}</span>}
 </button>
 ))}
 </div>

 <main className="flex-1 overflow-hidden min-h-0 bg-slate-100">
 {tab === 'migrate' && (!isActive ? <PreMigrationView /> : <MigrationView />)}
 {tab === 'history' && <div className="h-full p-4 overflow-hidden"><RunHistory /></div>}
 {tab === 'fhir' && <FhirDataPage />}
 {tab === 'target' && <TargetHealthPage />}
 {tab === 'mock' && <MockAdminPage />}
 </main>

 {approvalGate && <ApprovalModal />}
 <SchemaDriftDrawer />
 </div>
 )
}
