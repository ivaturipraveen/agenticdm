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

  const handleApprove = async () => { setApproving(true); await approveFn(); setApproving(false) }
  const handleRejectLoad = async () => { setHalting(true); await haltFn('approval_reject'); setHalting(false) }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <div className="relative z-10 w-full max-w-xl mx-4 bg-white border-2 border-amber-400 rounded-3xl shadow-2xl overflow-hidden">
        <div className="h-1 bg-gradient-to-r from-amber-300 via-amber-500 to-amber-300" />
        <div className="p-8">
          <div className="text-center mb-8">
            <h2 className="text-2xl font-bold text-slate-900">Approve FHIR load?</h2>
            <p className="text-slate-600 text-sm mt-2">
              This is the <span className="font-semibold text-slate-800">final step</span> before posting resources to your FHIR endpoint.
              Field-mapping reviews are already resolved — you are only confirming the bulk load.
            </p>
            <div className="mt-3 inline-flex items-center gap-2 px-4 py-1.5 bg-amber-50 border border-amber-300 rounded-full">
              <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
              <span className="text-amber-700 font-mono text-sm font-semibold">Waiting {mm}:{ss}</span>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 mb-8">
            <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 text-center">
              <div className="text-3xl font-bold text-slate-900 font-mono">{approvalGate.records_to_load.toLocaleString()}</div>
              <div className="text-slate-500 text-sm mt-1">Records Ready to Load</div>
            </div>
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-center">
              <div className="text-3xl font-bold text-amber-700 font-mono">{approvalGate.anomaly_count}</div>
              <div className="text-slate-500 text-sm mt-1">Anomalies Quarantined</div>
            </div>
            <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 text-center">
              <div className="text-3xl font-bold text-emerald-700 font-mono">{approvalGate.success_rate}%</div>
              <div className="text-slate-500 text-sm mt-1">Transform Success Rate</div>
            </div>
            <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 text-center">
              <div className={`text-xl font-bold mt-1 ${approvalGate.validation_passed ? 'text-emerald-700' : 'text-amber-700'}`}>
                {approvalGate.validation_passed ? 'PASSED' : 'ISSUES'}
              </div>
              <div className="text-slate-500 text-sm mt-1">Pre-load Validation</div>
            </div>
          </div>
          {!approvalGate.validation_passed && (
            <div className="mb-5 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-700 text-sm">
              Validation issues detected. Review before proceeding.
            </div>
          )}
          <p className="text-xs text-slate-500 text-center mb-4">
            Rejecting does not delete your run: it is recorded as halted (same as Stop), and nothing is sent to FHIR.
          </p>
          <div className="flex gap-4">
            <button onClick={handleApprove} disabled={approving || halting}
              className="flex-1 flex items-center justify-center gap-2 py-4 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 disabled:cursor-not-allowed text-white font-bold rounded-2xl transition-all text-base shadow-sm">
              {approving ? <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />Approving…</> : 'Approve & Load to FHIR'}
            </button>
            <button type="button" onClick={handleRejectLoad} disabled={approving || halting}
              className="flex-1 flex items-center justify-center gap-2 py-4 border-2 border-red-300 text-red-700 hover:bg-red-50 disabled:opacity-60 disabled:cursor-not-allowed font-bold rounded-2xl transition-all text-base">
              {halting ? <><span className="w-4 h-4 border-2 border-red-300 border-t-red-600 rounded-full animate-spin" />Saving…</> : 'Reject load'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
