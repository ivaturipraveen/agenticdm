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
import CompliancePage from './components/CompliancePage'

type TopTab = 'migrate' | 'history' | 'compliance'

export default function App() {
 useWebSocket()
 const stage = usePipelineStore((s) => s.stage)
 const approvalGate = usePipelineStore((s) => s.approvalGate)
 const compliance = usePipelineStore((s) => s.compliance)
 const runs = usePipelineStore((s) => s.runs)
 const [tab, setTab] = useState<TopTab>('migrate')

 const isActive = stage !== 'IDLE'
 const isRunning = !['IDLE', 'COMPLETE', 'HALTED'].includes(stage)

 // Auto-switch to migrate tab when pipeline starts
 useEffect(() => {
 if (isRunning) setTab('migrate')
 }, [isRunning])

 const completedRuns = runs.filter(r => r.status === 'complete').length

 return (
 <div className="h-screen flex flex-col bg-[#0A0F1E] overflow-hidden">
 <Toaster
 position="top-right"
 toastOptions={{
 style: { background: '#1E293B', color: '#E2E8F0', border: '1px solid #334155', fontSize: '13px', borderRadius: '10px' },
 duration: 4000,
 }}
 />

 <Header />
 <SchemaDriftBanner />
 {isActive && tab === 'migrate' && <PipelineStepper />}

 {/* Tab bar */}
 <div className="flex items-center gap-1 px-6 border-b border-slate-800 shrink-0 bg-[#0A0F1E]">
 {([
 { id: 'migrate' as const, label: ' Migration', badge: null },
 { id: 'history' as const, label: ' Run History', badge: completedRuns > 0 ? String(completedRuns) : null },
 { id: 'compliance' as const, label: ' Compliance',
 badge: compliance ? `${compliance.overall_score.toFixed(0)}%` : null,
 badgeColor: compliance
 ? compliance.overall_score >= 90 ? 'bg-emerald-500/20 text-emerald-400'
 : compliance.overall_score >= 70 ? 'bg-amber-500/20 text-amber-400'
 : 'bg-red-500/20 text-red-400'
 : 'bg-slate-700 text-slate-400'
 },
 ]).map(t => (
 <button
 key={t.id}
 onClick={() => setTab(t.id)}
 className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-all ${
 tab === t.id
 ? 'border-blue-500 text-white'
 : 'border-transparent text-slate-500 hover:text-slate-300 hover:border-slate-600'
 }`}
 >
 {t.label}
 {t.badge && (
 <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${'badgeColor' in t && t.badgeColor ? t.badgeColor : 'bg-slate-700 text-slate-400'}`}>
 {t.badge}
 </span>
 )}
 </button>
 ))}
 </div>

 {/* Content */}
 <main className="flex-1 overflow-hidden min-h-0">
 {tab === 'migrate' && (!isActive ? <PreMigrationView /> : <MigrationView />)}
 {tab === 'history' && (
 <div className="h-full p-4 overflow-hidden">
 <RunHistory />
 </div>
 )}
 {tab === 'compliance' && <CompliancePage />}
 </main>

 {approvalGate && <ApprovalModal />}
 <SchemaDriftDrawer />
 </div>
 )
}
