import { usePipelineStore } from '../store/pipelineStore'

export default function EmptyState() {
 const startFn = usePipelineStore((s) => s.startPipeline)

 return (
 <div className="flex flex-col items-center justify-center flex-1 gap-6 py-20">
 <div className="w-20 h-20 rounded-2xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-5xl">
 
 </div>
 <div className="text-center">
 <h1 className="text-3xl font-bold text-white">Brightcone Migration Platform</h1>
 <p className="text-slate-400 mt-2 text-lg">Healthcare Data Migration &amp; System Integration</p>
 <p className="text-slate-500 mt-1 text-sm">500 synthetic records · PostgreSQL HAPI FHIR R4</p>
 </div>

 <div className="flex gap-6 text-center">
 <div className="bg-navy-light border border-navy-border rounded-lg px-5 py-3">
 <div className="text-2xl font-bold text-blue-400">150</div>
 <div className="text-xs text-slate-500 mt-0.5">Members</div>
 </div>
 <div className="bg-navy-light border border-navy-border rounded-lg px-5 py-3">
 <div className="text-2xl font-bold text-purple-400">150</div>
 <div className="text-xs text-slate-500 mt-0.5">Eligibility</div>
 </div>
 <div className="bg-navy-light border border-navy-border rounded-lg px-5 py-3">
 <div className="text-2xl font-bold text-emerald-400">350</div>
 <div className="text-xs text-slate-500 mt-0.5">Claims</div>
 </div>
 </div>

 <div className="flex flex-col items-center gap-3">
 <button
 onClick={startFn}
 className="px-10 py-4 bg-blue-500 hover:bg-blue-400 text-white font-bold rounded-xl text-lg shadow-lg shadow-blue-500/25 transition-all hover:scale-105 active:scale-95"
 >
 Run Migration
 </button>
 <p className="text-slate-600 text-xs">5 specialized agents · HIPAA-grade audit log · Human approval gate</p>
 </div>
 </div>
 )
}
