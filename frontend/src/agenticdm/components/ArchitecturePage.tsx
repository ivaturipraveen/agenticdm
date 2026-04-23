export default function ArchitecturePage() {
  const layers = [
    ['Synthetic Data', 'Synthea-style synthetic claims, eligibility, and member records'],
    ['Source System', 'PostgreSQL legacy source tables used as the migration origin'],
    ['Agent Layer', 'Discovery, Transformation, Orchestration, QA, and Monitor agents'],
    ['Target System', 'FHIR endpoint plus persisted local FHIR resource store'],
    ['Governance Layer', 'Approval gate, auditability, review controls, and reconciliation'],
  ]

  return (
    <div className="h-full overflow-y-auto p-4 bg-slate-100">
      <div className="rounded-3xl border border-slate-200 bg-white overflow-hidden shadow-sm">
        <div className="px-6 py-5 border-b border-slate-200 bg-slate-50">
          <div className="text-slate-900 font-bold text-xl">Mock Environment Architecture</div>
          <div className="text-slate-500 text-sm mt-1">High-level view of the demo environment and how the agentic pipeline moves data through the stack.</div>
        </div>
        <div className="p-6 space-y-5 bg-slate-50/50">
          <div className="grid grid-cols-5 gap-4">
            {layers.map(([title, desc], idx) => (
              <div key={title} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="w-9 h-9 rounded-2xl bg-blue-600 text-white font-bold flex items-center justify-center mb-3">{idx + 1}</div>
                <div className="text-slate-900 font-semibold">{title}</div>
                <div className="text-slate-500 text-sm mt-2 leading-relaxed">{desc}</div>
              </div>
            ))}
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-slate-900 font-semibold mb-3">Flow</div>
            <div className="text-slate-700 text-sm leading-relaxed">Synthetic data is loaded into PostgreSQL source tables. The Discovery Agent inspects schema and relationships, the Transformation Agent reshapes records into FHIR-ready structures, the Orchestration Agent validates and coordinates human approval plus loading, the QA Agent verifies source-to-target integrity, and the Integration Monitor Agent watches for schema drift throughout execution.</div>
          </div>
        </div>
      </div>
    </div>
  )
}
