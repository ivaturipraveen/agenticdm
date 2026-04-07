import clsx from 'clsx'
import { usePipelineStore } from '../store/pipelineStore'
import { PipelineStage } from '../types/pipeline'

interface Step { id: PipelineStage; label: string; icon: string; agent: string }
const STEPS: Step[] = [
 { id: 'EXTRACT', label: 'Extract', icon: '', agent: 'Agent 1' },
 { id: 'TRANSFORM', label: 'Transform', icon: '', agent: 'Agent 2' },
 { id: 'VALIDATE', label: 'Validate', icon: '', agent: 'Agent 3' },
 { id: 'AWAITING_APPROVAL', label: 'Approval', icon: '⏸', agent: 'Human Gate' },
 { id: 'LOAD', label: 'Load FHIR', icon: '', agent: 'Agent 3' },
 { id: 'RECONCILE', label: 'Reconcile', icon: '', agent: 'Agent 4' },
]

const ORDER: PipelineStage[] = ['IDLE','EXTRACT','TRANSFORM','VALIDATE','AWAITING_APPROVAL','LOAD','RECONCILE','COMPLETE','HALTED']

function stepStatus(stepId: PipelineStage, current: PipelineStage): 'idle' | 'active' | 'done' | 'failed' {
 if (current === 'COMPLETE') return 'done'
 if (current === 'HALTED') {
 const ci = ORDER.indexOf(current), si = ORDER.indexOf(stepId)
 return si < ci ? 'done' : si === ci ? 'failed' : 'idle'
 }
 const ci = ORDER.indexOf(current), si = ORDER.indexOf(stepId)
 if (si < ci) return 'done'
 if (si === ci) return 'active'
 return 'idle'
}

export default function PipelineStepper() {
 const stage = usePipelineStore((s) => s.stage)

 return (
 <div className="px-6 py-4 border-b border-slate-800 bg-[#0D1424] shrink-0">
 <div className="flex items-center max-w-5xl mx-auto">
 {STEPS.map((step, i) => {
 const s = stepStatus(step.id, stage)
 return (
 <div key={step.id} className="flex items-center flex-1">
 <div className="flex flex-col items-center gap-1 shrink-0">
 <div className={clsx(
 'w-11 h-11 rounded-xl flex items-center justify-center text-lg border-2 transition-all duration-500 relative',
 s === 'active' && 'border-blue-500 bg-blue-500/10 animate-pulse-blue',
 s === 'done' && 'border-emerald-500 bg-emerald-500/10',
 s === 'failed' && 'border-red-500 bg-red-500/10',
 s === 'idle' && 'border-slate-700 bg-slate-900/50',
 )}>
 {s === 'done' ? <span className="text-emerald-400 font-bold"></span>
 : s === 'failed' ? <span className="text-red-400 font-bold"></span>
 : <span>{step.icon}</span>}
 {s === 'active' && (
 <span className="absolute -top-1 -right-1 w-3 h-3 bg-blue-500 rounded-full animate-ping" />
 )}
 </div>
 <div className={clsx('text-center', s === 'idle' && 'text-slate-600', s === 'active' && 'text-blue-400', s === 'done' && 'text-emerald-400', s === 'failed' && 'text-red-400')}>
 <div className="text-xs font-semibold leading-none">{step.label}</div>
 <div className="text-[10px] mt-0.5 opacity-60">{step.agent}</div>
 </div>
 </div>
 {i < STEPS.length - 1 && (
 <div className={clsx('pipeline-line', s === 'done' && 'done', s === 'active' && 'active')} />
 )}
 </div>
 )
 })}
 </div>
 </div>
 )
}
