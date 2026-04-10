import clsx from 'clsx'
import { usePipelineStore } from '../store/pipelineStore'
import { PipelineStage } from '../types/pipeline'

interface Step { id: PipelineStage; label: string; agent: string; num: number }
const STEPS: Step[] = [
  { id: 'EXTRACT',           num: 1, label: 'Extract',    agent: 'Discovery Agent'       },
  { id: 'TRANSFORM',         num: 2, label: 'Transform',  agent: 'Transformation Agent'  },
  { id: 'VALIDATE',          num: 3, label: 'Validate',   agent: 'Orchestration Agent'   },
  { id: 'AWAITING_APPROVAL', num: 4, label: 'Approval',   agent: 'Final FHIR load'       },
  { id: 'LOAD',              num: 5, label: 'Load FHIR',  agent: 'Orchestration Agent'   },
  { id: 'RECONCILE',         num: 6, label: 'Reconcile',  agent: 'QA Agent'              },
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
    <div className="border-b border-slate-200 bg-white shrink-0">
      <div className="max-w-7xl mx-auto px-6 py-4">
        <div className="flex items-center gap-0">
          {STEPS.map((step, idx) => {
            const s = stepStatus(step.id, stage)
            const isLast = idx === STEPS.length - 1
            return (
              <div key={step.id} className="flex items-center flex-1 min-w-0">
                {/* Node */}
                <div className="flex flex-col items-center shrink-0">
                  <div className={clsx(
                    'w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold border-2 transition-all',
                    s === 'done'   ? 'bg-emerald-500 border-emerald-500 text-white' :
                    s === 'active' ? 'bg-blue-600 border-blue-600 text-white ring-4 ring-blue-100' :
                                     'bg-white border-slate-300 text-slate-400'
                  )}>
                    {s === 'done' ? '✓' : step.num}
                    {s === 'active' && (
                      <span className="absolute w-3 h-3 bg-blue-400 rounded-full animate-ping opacity-60 -top-0.5 -right-0.5 pointer-events-none" />
                    )}
                  </div>
                  <div className="mt-2 text-center">
                    <div className={clsx('text-xs font-semibold leading-tight', s === 'done' ? 'text-emerald-700' : s === 'active' ? 'text-blue-700' : 'text-slate-400')}>
                      {step.label}
                    </div>
                    <div className={clsx('text-[10px] mt-0.5 leading-tight', s === 'active' ? 'text-blue-500' : 'text-slate-400')}>
                      {step.agent}
                    </div>
                  </div>
                </div>
                {/* Connector */}
                {!isLast && (
                  <div className={clsx('flex-1 h-0.5 mx-2 mt-[-18px] rounded-full transition-all', s === 'done' ? 'bg-emerald-400' : 'bg-slate-200')} />
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
