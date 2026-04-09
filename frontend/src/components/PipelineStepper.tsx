import clsx from 'clsx'
import { usePipelineStore } from '../store/pipelineStore'
import { PipelineStage } from '../types/pipeline'

interface Step { id: PipelineStage; label: string; agent: string }
const STEPS: Step[] = [
 { id: 'EXTRACT', label: 'Extract', agent: 'Discovery Agent' },
 { id: 'TRANSFORM', label: 'Transform', agent: 'Transformation Agent' },
 { id: 'VALIDATE', label: 'Validate', agent: 'Orchestration Agent' },
 { id: 'AWAITING_APPROVAL', label: 'Approval', agent: 'Human Gate' },
 { id: 'LOAD', label: 'Load FHIR', agent: 'Orchestration Agent' },
 { id: 'RECONCILE', label: 'Reconcile', agent: 'QA Agent' },
]

const ORDER: PipelineStage[] = ['IDLE','EXTRACT','TRANSFORM','VALIDATE','AWAITING_APPROVAL','LOAD','RECONCILE','COMPLETE','HALTED']

function stepStatus(stepId: PipelineStage, current: PipelineStage): 'idle' | 'active' | 'done' {
 if (current === 'COMPLETE') return 'done'
 const ci = ORDER.indexOf(current)
 const si = ORDER.indexOf(stepId)
 if (si < ci) return 'done'
 if (si === ci) return 'active'
 return 'idle'
}

export default function PipelineStepper() {
 const stage = usePipelineStore((s) => s.stage)

 return (
 <div className="px-6 py-5 border-b border-slate-200 bg-white shrink-0">
 <div className="max-w-6xl mx-auto grid grid-cols-6 gap-4">
 {STEPS.map((step) => {
 const s = stepStatus(step.id, stage)
 return (
 <div key={step.id} className={clsx('rounded-2xl border p-4 transition-all', s === 'active' ? 'border-blue-200 bg-blue-50' : s === 'done' ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-slate-50')}>
 <div className="flex items-center justify-between">
 <div className="text-xs uppercase tracking-wider text-slate-500 font-semibold">{step.label}</div>
 <div className={clsx('w-2.5 h-2.5 rounded-full', s === 'active' ? 'bg-blue-500 animate-pulse' : s === 'done' ? 'bg-emerald-500' : 'bg-slate-300')} />
 </div>
 <div className="text-sm font-semibold text-slate-900 mt-2">{step.agent}</div>
 </div>
 )
 })}
 </div>
 </div>
 )
}
