import { useEffect, useState } from 'react'
import { usePipelineStore } from '../store/pipelineStore'

export default function ApprovalModal() {
 const approvalGate = usePipelineStore((s) => s.approvalGate)
 const approveFn = usePipelineStore((s) => s.approvePipeline)
 const haltFn = usePipelineStore((s) => s.haltPipeline)
 const [secs, setSecs] = useState(0)
 const [approving, setApproving] = useState(false)
 const [halting, setHalting] = useState(false)

 useEffect(() => {
 if (!approvalGate) { setSecs(0); return }
 const start = new Date(approvalGate.waiting_since).getTime()
 const id = setInterval(() => setSecs(Math.floor((Date.now() - start) / 1000)), 1000)
 return () => clearInterval(id)
 }, [approvalGate])

 if (!approvalGate) return null

 const mm = String(Math.floor(secs / 60)).padStart(2, '0')
 const ss = String(secs % 60).padStart(2, '0')

 const handleApprove = async () => {
 setApproving(true)
 await approveFn()
 setApproving(false)
 }

 const handleHalt = async () => {
 setHalting(true)
 await haltFn()
 setHalting(false)
 }

 return (
 <div className="fixed inset-0 z-50 flex items-center justify-center">
 {/* Backdrop */}
 <div className="absolute inset-0 bg-black/70 backdrop-blur-md" />

 {/* Modal */}
 <div className="relative z-10 w-full max-w-xl mx-4 bg-[#0D1424] border-2 border-amber-500/50 rounded-2xl shadow-2xl shadow-amber-500/10 overflow-hidden animate-slide-up">
 <div className="h-0.5 bg-gradient-to-r from-amber-500/0 via-amber-500 to-amber-500/0" />

 <div className="p-8">
 {/* Title */}
 <div className="text-center mb-8">
 <div className="text-5xl mb-4">⏸</div>
 <h2 className="text-2xl font-bold text-white">Human Approval Required</h2>
 <p className="text-slate-400 text-sm mt-2">All agents are paused — review stats and confirm before FHIR load</p>
 <div className="mt-3 inline-flex items-center gap-2 px-4 py-1.5 bg-amber-500/10 border border-amber-500/30 rounded-full">
 <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
 <span className="text-amber-400 font-mono text-sm">Waiting {mm}:{ss}</span>
 </div>
 </div>

 {/* Stats */}
 <div className="grid grid-cols-2 gap-3 mb-8">
 <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 text-center">
 <div className="text-3xl font-bold text-white font-mono">{approvalGate.records_to_load.toLocaleString()}</div>
 <div className="text-slate-500 text-sm mt-1">Records Ready to Load</div>
 </div>
 <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 text-center">
 <div className="text-3xl font-bold text-amber-400 font-mono">{approvalGate.anomaly_count}</div>
 <div className="text-slate-500 text-sm mt-1">Anomalies Quarantined</div>
 </div>
 <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 text-center">
 <div className="text-3xl font-bold text-emerald-400 font-mono">{approvalGate.success_rate}%</div>
 <div className="text-slate-500 text-sm mt-1">Transform Success Rate</div>
 </div>
 <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 text-center">
 <div className={`text-xl font-bold mt-1 ${approvalGate.validation_passed ? 'text-emerald-400' : 'text-amber-400'}`}>
 {approvalGate.validation_passed ? ' PASSED' : ' ISSUES'}
 </div>
 <div className="text-slate-500 text-sm mt-1">Pre-load Validation</div>
 </div>
 </div>

 {!approvalGate.validation_passed && (
 <div className="mb-5 px-4 py-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-400 text-sm">
 Validation issues detected. Review the audit log before proceeding.
 </div>
 )}

 {/* Buttons */}
 <div className="flex gap-4">
 <button
 onClick={handleApprove}
 disabled={approving || halting}
 className="flex-1 flex items-center justify-center gap-2 py-4 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-60 disabled:cursor-not-allowed text-white font-bold rounded-xl transition-all text-base shadow-lg shadow-emerald-500/20 hover:scale-[1.02] active:scale-95"
 >
 {approving ? (
 <>
 <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
 Approving…
 </>
 ) : (
 <> Approve &amp; Load to FHIR</>
 )}
 </button>
 <button
 onClick={handleHalt}
 disabled={approving || halting}
 className="flex-1 flex items-center justify-center gap-2 py-4 bg-transparent hover:bg-red-500/10 disabled:opacity-60 disabled:cursor-not-allowed text-red-400 font-bold border-2 border-red-500/50 hover:border-red-400 rounded-xl transition-all text-base"
 >
 {halting ? (
 <>
 <span className="w-4 h-4 border-2 border-red-400/30 border-t-red-400 rounded-full animate-spin" />
 Halting…
 </>
 ) : (
 <> Halt Pipeline</>
 )}
 </button>
 </div>
 </div>
 </div>
 </div>
 )
}
