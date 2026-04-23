import { useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import { usePipelineStore } from '../store/pipelineStore'
import { apiUrl } from '../api/client'
import { AgentName, MappingTableSummary, ReviewItem } from '../types/pipeline'

const AGENTS: { id: AgentName; num: number; title: string; subtitle: string; color: string }[] = [
 { id: 'discovery', num: 1, title: 'Discovery Agent', subtitle: 'Reads source tables and infers FHIR mappings', color: 'blue' },
 { id: 'transformation', num: 2, title: 'Transformation Agent', subtitle: 'Converts source rows into FHIR-ready output', color: 'violet' },
 { id: 'orchestration', num: 3, title: 'Orchestration Agent', subtitle: 'Coordinates review, approval, and load', color: 'cyan' },
 { id: 'qa', num: 4, title: 'QA / Reconciliation Agent', subtitle: 'Verifies source-to-output integrity', color: 'emerald' },
 { id: 'monitor', num: 5, title: 'Integration Monitor Agent', subtitle: 'Watches for schema drift during execution', color: 'amber' },
]

const COLOR: Record<string, { panel: string; border: string; text: string; soft: string }> = {
 blue: { panel: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-700', soft: 'bg-blue-50' },
 violet: { panel: 'bg-violet-50', border: 'border-violet-200', text: 'text-violet-700', soft: 'bg-violet-50' },
 cyan: { panel: 'bg-cyan-50', border: 'border-cyan-200', text: 'text-cyan-700', soft: 'bg-cyan-50' },
 emerald: { panel: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-700', soft: 'bg-emerald-50' },
 amber: { panel: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-700', soft: 'bg-amber-50' },
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
 return (
 <div>
 <div className="mb-3">
 <div className="text-sm font-bold text-slate-900">{title}</div>
 {subtitle && <div className="text-xs text-slate-500 mt-0.5">{subtitle}</div>}
 </div>
 {children}
 </div>
 )
}

function MetricCard({ label, value, tone = 'text-slate-900' }: { label: string; value: string | number; tone?: string }) {
 return <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><div className={clsx('text-2xl font-bold font-mono', tone)}>{value}</div><div className="text-xs text-slate-500 mt-1">{label}</div></div>
}

function TechnicalDetails({ title, data }: { title: string; data: unknown }) {
 const [open, setOpen] = useState(false)
 return (
 <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-sm">
 <button onClick={() => setOpen(v => !v)} className="w-full flex items-center justify-between px-4 py-3 text-left bg-slate-50">
 <span className="text-sm font-semibold text-slate-700">{title}</span>
 <span className="text-slate-500 text-xs">{open ? 'Hide details' : 'Show technical details'}</span>
 </button>
 {open && <pre className="p-4 border-t border-slate-200 text-xs text-slate-700 overflow-x-auto whitespace-pre-wrap">{JSON.stringify(data, null, 2)}</pre>}
 </div>
 )
}

function MappingTableCard({ table }: { table: MappingTableSummary }) {
 const autoFields = table.fields.filter(f => f.status === 'auto_mapped')
 const reviewFields = table.fields.filter(f => f.status === 'requires_review')
 return (
 <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-sm">
 <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
 <div>
 <div className="text-slate-900 font-semibold">{table.table} {'->'} {table.resource}</div>
 <div className="text-xs text-slate-500 mt-1">{table.row_count.toLocaleString()} rows • confidence {Math.round(table.resource_confidence * 100)}%</div>
 </div>
 <div className="text-right text-xs">
 <div className="text-emerald-700">{autoFields.length} auto-mapped</div>
 <div className="text-amber-700">{reviewFields.length} in review</div>
 </div>
 </div>
 <div className="p-4 grid grid-cols-2 gap-4">
 <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
 <div className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold mb-2">Source Input</div>
 <div className="space-y-2">
 {table.fields.slice(0, 8).map((field) => <div key={field.source_column} className="flex items-center justify-between gap-2 text-sm"><span className="font-mono text-slate-700">{field.source_column}</span><span className="text-slate-500 text-xs">{field.data_type}</span></div>)}
 </div>
 </div>
 <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
 <div className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold mb-2">Mapped Output</div>
 <div className="space-y-2">
 {table.fields.slice(0, 8).map((field) => <div key={field.source_column} className="flex items-center justify-between gap-2 text-sm"><span className="font-mono text-slate-700 truncate">{field.target_field || 'Unmapped'}</span><span className={clsx('text-xs font-semibold', field.status === 'auto_mapped' ? 'text-emerald-700' : field.status === 'requires_review' ? 'text-amber-700' : 'text-slate-500')}>{Math.round(field.confidence * 100)}%</span></div>)}
 </div>
 </div>
 </div>
 </div>
 )
}

function ReviewCard({ item }: { item: ReviewItem }) {
 const resolve = usePipelineStore(s => s.resolveReviewItem)
 const [customTarget, setCustomTarget] = useState(item.target_field || '')
 return (
 <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-4 shadow-sm">
 <div className="flex items-start justify-between gap-4">
 <div>
 <div className="text-slate-900 font-semibold">Review required for {item.table}.{item.source_column}</div>
 <div className="text-sm text-slate-600 mt-1">The system is unsure about this mapping and needs confirmation before continuing.</div>
 </div>
 <span className="px-2 py-0.5 rounded-md bg-amber-100 text-amber-700 text-xs font-semibold">Needs review</span>
 </div>
 <div className="grid grid-cols-3 gap-4">
 <div className="rounded-lg border border-slate-200 bg-white p-3"><div className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold mb-2">Source field</div><div className="font-mono text-slate-800">{item.source_column}</div></div>
 <div className="rounded-lg border border-slate-200 bg-white p-3"><div className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold mb-2">Suggested target</div><div className="font-mono text-amber-700 break-all">{item.target_field || 'No suggestion'}</div></div>
 <div className="rounded-lg border border-slate-200 bg-white p-3"><div className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold mb-2">Confidence</div><div className="text-slate-900 font-mono text-lg">{Math.round(item.confidence * 100)}%</div></div>
 </div>
 <div className="rounded-lg border border-slate-200 bg-white p-3"><div className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold mb-2">Why this was flagged</div><div className="text-sm text-slate-700">{item.reason}</div></div>
 <div className="flex items-center gap-2">
 <input value={customTarget} onChange={(e) => setCustomTarget(e.target.value)} placeholder="Edit the FHIR target field if needed" className="flex-1 bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-700" />
 <button onClick={() => resolve({ table: item.table, source_column: item.source_column, decision: 'accept', selected_target: item.target_field || undefined })} className="px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold">Accept</button>
 <button onClick={() => resolve({ table: item.table, source_column: item.source_column, decision: 'edit', selected_target: customTarget })} className="px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold">Use edit</button>
 <button onClick={() => resolve({ table: item.table, source_column: item.source_column, decision: 'reject' })} className="px-3 py-2 rounded-lg border border-red-200 text-red-700 hover:bg-red-50 text-sm font-semibold bg-white">Reject</button>
 </div>
 </div>
 )
}

function DiscoveryView() {
 const schemaMapping = usePipelineStore(s => s.schemaMapping)
 const allPendingReviews = usePipelineStore(s => s.pendingReviews)
 // Deduplicate: show one review card per unique (table, source_column) pair
 const seen = new Set<string>()
 const pendingReviews = allPendingReviews.filter(r => {
 const key = `${r.table}::${r.source_column}`
 if (seen.has(key)) return false
 seen.add(key)
 return true
 })
 if (!schemaMapping) return (
 <div className="p-8 flex flex-col items-center gap-3 text-slate-400">
 <div className="w-12 h-12 border-2 border-slate-300 border-t-blue-500 rounded-full animate-spin" />
 <div className="text-base">Discovery is running…</div>
 </div>
 )
 return (
 <div className="space-y-5">
 {/* Summary metrics */}
 <div className="grid grid-cols-4 gap-4">
 <MetricCard label="Tables scanned" value={schemaMapping.summary.tables_scanned} />
 <MetricCard label="Source rows" value={schemaMapping.summary.total_rows.toLocaleString()} />
 <MetricCard label="Auto-mapped fields" value={schemaMapping.summary.auto_mapped_fields} tone="text-emerald-700" />
 <MetricCard label="Needs review" value={schemaMapping.summary.requires_review_fields} tone={schemaMapping.summary.requires_review_fields > 0 ? 'text-amber-700' : 'text-slate-500'} />
 </div>

 {/* Role explanation */}
 <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
 <div className="text-sm font-bold text-slate-900 mb-2">How Discovery works</div>
 <div className="text-sm text-slate-600 leading-relaxed mb-3">
 The Discovery Agent reads each source table, scores every column against FHIR field patterns, and assigns a confidence percentage. 
 Fields with <span className="font-semibold text-emerald-700">&ge;85% confidence</span> are auto-mapped. 
 Fields between <span className="font-semibold text-amber-700">55–84%</span> are shown for your review. 
 Fields below 55% (e.g. <code>dataset_id</code>, <code>created_at</code>) are system/operational columns — not patient data — and are safely ignored.
 </div>
 <div className="grid grid-cols-3 gap-3 text-sm">
 <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3"><div className="font-semibold text-emerald-700">Auto-mapped</div><div className="text-emerald-600 text-xs mt-1">High confidence — mapped automatically</div></div>
 <div className="rounded-xl bg-amber-50 border border-amber-200 p-3"><div className="font-semibold text-amber-700">Needs review</div><div className="text-amber-600 text-xs mt-1">Uncertain mapping — you confirm once</div></div>
 <div className="rounded-xl bg-slate-100 border border-slate-200 p-3"><div className="font-semibold text-slate-600">Ignored</div><div className="text-slate-500 text-xs mt-1">System metadata — not part of patient record</div></div>
 </div>
 </div>

 {/* Mapping results per table — filter out system tables */}
 <Section title="Source Table Mapping" subtitle="How each medical source table was mapped to a FHIR resource type.">
 <div className="space-y-4">
 {schemaMapping.mapping_summary.filter(t => ['members','eligibility','claims'].includes(t.table)).map((table) => (
 <div key={table.table} className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm">
 <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
 <div>
 <span className="font-semibold text-slate-900">{table.table}</span>
 <span className="mx-2 text-slate-400">{'->'}</span>
 <span className="font-semibold text-blue-700">{table.resource}</span>
 <span className="ml-2 text-xs text-slate-500">• {table.row_count.toLocaleString()} rows • {Math.round(table.resource_confidence * 100)}% confidence</span>
 </div>
 <div className="flex gap-3 text-xs">
 <span className="text-emerald-700 font-semibold">{table.fields.filter(f => f.status === 'auto_mapped').length} auto-mapped</span>
 {table.fields.filter(f => f.status === 'requires_review').length > 0 && <span className="text-amber-700 font-semibold">{table.fields.filter(f => f.status === 'requires_review').length} for review</span>}
 </div>
 </div>
 <table className="w-full text-xs">
 <thead><tr className="bg-slate-50 border-b border-slate-100">
 <th className="text-left px-4 py-2.5 text-slate-500 font-semibold w-[30%]">Source column</th>
 <th className="text-left px-4 py-2.5 text-slate-500 font-semibold w-[38%]">FHIR R4 field</th>
 <th className="text-left px-4 py-2.5 text-slate-500 font-semibold w-[18%]">Confidence</th>
 <th className="text-left px-4 py-2.5 text-slate-500 font-semibold w-[14%]">Status</th>
 </tr></thead>
 <tbody>
 {table.fields.map((field) => (
 <tr key={field.source_column} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/50">
 <td className="px-4 py-2.5 font-mono text-slate-700">{field.source_column}</td>
 <td className="px-4 py-2.5 font-mono text-blue-700 truncate max-w-[200px]">{field.target_field || <span className="text-slate-400">—</span>}</td>
 <td className="px-4 py-2.5">
 <div className="flex items-center gap-2">
 <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
 <div className={clsx('h-full rounded-full', field.confidence >= 0.85 ? 'bg-emerald-500' : field.confidence >= 0.55 ? 'bg-amber-400' : 'bg-slate-300')} style={{ width: `${Math.round(field.confidence * 100)}%` }} />
 </div>
 <span className="text-slate-600 font-mono">{Math.round(field.confidence * 100)}%</span>
 </div>
 </td>
 <td className="px-4 py-2.5">
 <span className={clsx('px-2 py-0.5 rounded-full text-[11px] font-semibold', field.status === 'auto_mapped' ? 'bg-emerald-100 text-emerald-700' : field.status === 'requires_review' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500')}>
 {field.status === 'auto_mapped' ? 'Auto-mapped' : field.status === 'requires_review' ? 'Needs review' : 'Ignored'}
 </span>
 </td>
 </tr>
 ))}
 </tbody>
 </table>
 </div>
 ))}
 </div>
 </Section>

 {/* Review queue — field-level mapping, not the final FHIR load approval */}
 {pendingReviews.length > 0 && (
 <div className="rounded-2xl border-2 border-amber-300 bg-amber-50 overflow-hidden shadow-sm">
 <div className="px-5 py-4 border-b border-amber-200">
 <div className="flex items-center justify-between">
 <div>
 <div className="text-[10px] font-bold uppercase tracking-wider text-amber-800/80 mb-1">Field mapping review</div>
 <div className="font-bold text-amber-900">{pendingReviews.length} field{pendingReviews.length > 1 ? 's' : ''} need your decision</div>
 <div className="text-sm text-amber-700 mt-1">Pipeline is paused. Resolve each field below, then it will continue automatically. Each decision applies to all rows with that field.</div>
 </div>
 <button
 onClick={() => { pendingReviews.forEach(item => usePipelineStore.getState().resolveReviewItem({ table: item.table, source_column: item.source_column, decision: 'reject' })) }}
 className="ml-4 px-4 py-2 rounded-xl border border-amber-400 text-amber-900 bg-white hover:bg-amber-100 text-sm font-semibold shrink-0"
 >Skip all & continue</button>
 </div>
 </div>
 <div className="p-4 space-y-3">
 {pendingReviews.map((item, idx) => <ReviewCard key={`${item.table}-${item.source_column}-${idx}`} item={item} />)}
 </div>
 </div>
 )}
 {pendingReviews.length === 0 && schemaMapping.summary.requires_review_fields === 0 && (
 <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700 shadow-sm">
 All fields were auto-mapped. No review required — the pipeline will continue.
 </div>
 )}
 </div>
 )
}

function TransformationView() {
 const migrationSummary = usePipelineStore(s => s.migrationSummary) as any
 const schemaMapping = usePipelineStore(s => s.schemaMapping)
 const agents = usePipelineStore(s => s.agents)
 const pendingReviews = usePipelineStore(s => s.pendingReviews)
 const fhirSamples = migrationSummary?.agent_outputs?.fhir_samples || []
 const validationErrors = migrationSummary?.agent_outputs?.validation_errors || []
 const reviewItems = migrationSummary?.agent_outputs?.review_items || []
 // Use live agent records_processed while run is active; fall back to summary after complete
 const sourceRows = migrationSummary?.total_source ?? schemaMapping?.summary?.total_rows ?? agents.transformation.records_processed
 const outputRows = migrationSummary?.total_loaded ?? agents.transformation.records_processed
 return (
 <div className="space-y-5">
 <div className="grid grid-cols-4 gap-4">
 <MetricCard label="Source rows processed" value={sourceRows || 0} />
 <MetricCard label="FHIR rows produced" value={outputRows || 0} tone="text-violet-700" />
 <MetricCard label="Review items" value={pendingReviews.length || reviewItems.length} tone="text-amber-700" />
 <MetricCard label="Validation issues" value={validationErrors.length} tone={validationErrors.length ? 'text-red-700' : 'text-emerald-700'} />
 </div>
 <Section title="What this agent is doing" subtitle="Transformation applies the mapping contract and converts source rows into FHIR-ready output.">
 <div className="grid grid-cols-2 gap-4">
 <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><div className="text-sm font-semibold text-slate-900 mb-2">Input</div><div className="text-sm text-slate-600">Confirmed mapping decisions and source records.</div></div>
 <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><div className="text-sm font-semibold text-slate-900 mb-2">Output</div><div className="text-sm text-slate-600">FHIR-ready resources, flagged review items, and validation results.</div></div>
 </div>
 </Section>
 <Section title="Converted output samples" subtitle="Examples of how source data is being transformed.">
 <div className="grid grid-cols-2 gap-4">{fhirSamples.slice(0, 2).map((sample: unknown, idx: number) => <div key={idx} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><div className="text-sm font-semibold text-slate-900 mb-2">Sample {idx + 1}</div><pre className="text-xs text-slate-700 whitespace-pre-wrap overflow-x-auto">{JSON.stringify(sample, null, 2)}</pre></div>)}</div>
 </Section>
 <Section title="Field mapping review" subtitle="Per-column mapping decisions — separate from the final “approve load to FHIR” step at the end of the run.">
 {pendingReviews.length === 0 ? <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-500 shadow-sm">No unresolved transformation review items.</div> : <div className="space-y-3">{pendingReviews.map((item, idx) => <ReviewCard key={`${item.table}-${item.source_column}-${idx}`} item={item} />)}</div>}
 </Section>
 <Section title="Validation results" subtitle="Rows that failed FHIR validation rules.">
 {validationErrors.length === 0 ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700 shadow-sm">No validation failures found.</div> : <div className="space-y-3">{validationErrors.map((err: any, idx: number) => <div key={idx} className="rounded-xl border border-red-200 bg-red-50 p-4 shadow-sm"><div className="text-sm font-semibold text-slate-900">{err.table} row {err.record_index + 1}</div><div className="text-sm text-red-700 mt-2">{(err.errors || []).join(', ')}</div></div>)}</div>}
 </Section>
 <TechnicalDetails title="Transformation technical details" data={migrationSummary?.agent_outputs || {}} />
 </div>
 )
}

function OrchestrationView() {
 const migrationSummary = usePipelineStore(s => s.migrationSummary) as any
 const schemaMapping = usePipelineStore(s => s.schemaMapping)
 const agents = usePipelineStore(s => s.agents)
 const approvalGate = usePipelineStore(s => s.approvalGate)
 const stage = usePipelineStore(s => s.stage)
 const counts = migrationSummary?.agent_outputs?.resource_counts || {}
 const fhirSamples = migrationSummary?.agent_outputs?.fhir_samples || []
 const validationErrors = migrationSummary?.agent_outputs?.validation_errors || []
 // Live counts: use approval gate data, or agent records, or schema total while loading
 const liveReadyCount = approvalGate?.records_to_load
 ?? (stage === 'LOAD' || stage === 'RECONCILE' || stage === 'COMPLETE' ? (migrationSummary?.total_loaded ?? agents.orchestration.records_processed ?? schemaMapping?.summary?.total_rows ?? 0) : (schemaMapping?.summary?.total_rows ?? 0))
 // Show the REAL FHIR target the backend is configured to use, not a
 // hardcoded localhost fallback. After the first pipeline run the URL
 // comes from the run's agent_outputs; before that, we fetch it live
 // from /api/target/health so the card never lies about the target.
 const [configuredFhirUrl, setConfiguredFhirUrl] = useState<string>('')
 useEffect(() => {
   let cancelled = false
   fetch(apiUrl('/api/target/health'))
     .then(r => r.json())
     .then(d => { if (!cancelled) setConfiguredFhirUrl(d?.target || '') })
     .catch(() => { /* leave blank on error — better than a wrong default */ })
   return () => { cancelled = true }
 }, [])
 const liveFhirUrl = (migrationSummary?.agent_outputs as any)?.fhir_url
   || configuredFhirUrl
   || 'Not configured'
 const steps = [
 { key: 'EXTRACT', label: 'Extract', desc: 'Collect source rows from the selected dataset.' },
 { key: 'TRANSFORM', label: 'Transform', desc: 'Receive converted FHIR-ready data from Agent 2.' },
 { key: 'VALIDATE', label: 'Validate', desc: 'Check readiness, failures, and review status.' },
 { key: 'AWAITING_APPROVAL', label: 'Approval Gate', desc: 'Pause and wait for human confirmation.' },
 { key: 'LOAD', label: 'Load to Target', desc: 'Batch load resources into the configured FHIR target.' },
 { key: 'RECONCILE', label: 'Handoff to QA', desc: 'Send final loaded results to Agent 4.' },
 ]
 const order = ['IDLE','EXTRACT','TRANSFORM','VALIDATE','AWAITING_APPROVAL','LOAD','RECONCILE','COMPLETE','HALTED']
 const currentIndex = order.indexOf(stage)
 return (
 <div className="space-y-5">
 <div className="grid grid-cols-4 gap-4">
 <MetricCard label="Records in pipeline" value={liveReadyCount} />
 <MetricCard label="Validation issues" value={validationErrors.length} tone={validationErrors.length ? 'text-red-700' : 'text-emerald-700'} />
 <MetricCard label="Approval state" value={stage === 'AWAITING_APPROVAL' ? 'Waiting for approval' : ['LOAD','RECONCILE','COMPLETE'].includes(stage) ? 'Approved — loading' : 'Pending'} tone={stage === 'AWAITING_APPROVAL' ? 'text-amber-700' : ['LOAD','RECONCILE','COMPLETE'].includes(stage) ? 'text-emerald-700' : 'text-slate-500'} />
 <MetricCard label="Resource types" value={Object.keys(counts).length || 3} tone="text-cyan-700" />
 </div>

 <Section title="What this agent is doing" subtitle="Orchestration is the control tower for the run. It sequences stages, enforces validation, waits for approval, loads the target, and hands the result to QA.">
 <div className="grid grid-cols-3 gap-4">
 {steps.map((stepDef, idx) => {
 const stepIndex = order.indexOf(stepDef.key as any)
 const stateLabel = currentIndex > stepIndex || stage === 'COMPLETE' ? 'done' : currentIndex === stepIndex ? 'active' : 'pending'
 return <div key={stepDef.key} className={clsx('rounded-2xl border p-4 shadow-sm', stateLabel === 'done' ? 'border-emerald-200 bg-emerald-50' : stateLabel === 'active' ? 'border-cyan-200 bg-cyan-50' : 'border-slate-200 bg-white')}><div className="flex items-center justify-between"><div className="text-sm font-semibold text-slate-900">{idx + 1}. {stepDef.label}</div><div className={clsx('w-2.5 h-2.5 rounded-full', stateLabel === 'done' ? 'bg-emerald-500' : stateLabel === 'active' ? 'bg-cyan-500 animate-pulse' : 'bg-slate-300')} /></div><div className="text-xs text-slate-500 mt-2 leading-relaxed">{stepDef.desc}</div></div>
 })}
 </div>
 </Section>

 {/* FHIR endpoint */}
 <div className="rounded-2xl border border-cyan-200 bg-cyan-50 p-4 shadow-sm">
 <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">FHIR Target Endpoint</div>
 <div className="font-mono text-cyan-800 text-sm">{liveFhirUrl}</div>
 <div className="flex items-center gap-2 mt-2">
 <span className={clsx('w-2 h-2 rounded-full', ['LOAD','RECONCILE','COMPLETE'].includes(stage) ? 'bg-emerald-500' : 'bg-slate-300')} />
 <span className="text-xs text-slate-600">{['LOAD','RECONCILE','COMPLETE'].includes(stage) ? 'Actively sending resources to this endpoint' : 'Will send resources here after approval'}</span>
 </div>
 </div>

 <Section title="Load summary" subtitle={Object.keys(counts).length > 0 ? 'Resources sent to FHIR endpoint by type.' : stage === 'LOAD' ? 'Loading in progress…' : 'Will populate after load completes.'}>
 {Object.keys(counts).length > 0 ? (
 <div className="grid grid-cols-3 gap-4">{Object.entries(counts).map(([k, v]) => <MetricCard key={k} label={k} value={v as number} tone="text-cyan-700" />)}</div>
 ) : stage === 'LOAD' ? (
 <div className="rounded-2xl border border-cyan-200 bg-cyan-50 p-4 flex items-center gap-3">
 <div className="w-5 h-5 border-2 border-cyan-300 border-t-cyan-600 rounded-full animate-spin shrink-0" />
 <div>
 <div className="text-sm font-semibold text-cyan-800">Loading to FHIR endpoint…</div>
 <div className="text-xs text-cyan-600 mt-0.5">Sending Patient, Coverage and Claim resources in batches of 100</div>
 </div>
 </div>
 ) : (
 <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-500">Load has not started yet. Approve the pipeline to begin.</div>
 )}
 </Section>

 <Section title="Final load approval" subtitle="After validation, the pipeline opens a dialog to approve or reject posting resources to FHIR — this is not the same as field mapping review above.">
 {stage === 'AWAITING_APPROVAL' && approvalGate ? (
 <div className="rounded-2xl border-2 border-cyan-300 bg-cyan-50 p-5 shadow-sm">
 <div className="text-sm font-bold text-cyan-900 mb-2">Action required in the approval dialog</div>
 <p className="text-sm text-cyan-800 leading-relaxed">
 Use the popup overlay to <span className="font-semibold">approve and load</span> or <span className="font-semibold">reject</span>.
 Rejecting records the run as halted in the audit log and does not send data to FHIR.
 </p>
 </div>
 ) : (
 <div className="grid grid-cols-2 gap-4">
 <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
 <div className="text-sm font-semibold text-slate-900 mb-2">Gate status</div>
 <div className="text-sm text-slate-700 leading-relaxed">{approvalGate ? `Waiting to load ${approvalGate.records_to_load.toLocaleString()} records with ${approvalGate.anomaly_count} anomalies quarantined. Success rate: ${approvalGate.success_rate}%.` : 'Gate cleared — approved to load.'}</div>
 </div>
 <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
 <div className="text-sm font-semibold text-slate-900 mb-2">After approval</div>
 <div className="text-sm text-slate-700 leading-relaxed">Resources are batch-loaded to the FHIR endpoint above and stored in the FHIR Registry. The QA Agent then verifies the counts.</div>
 </div>
 </div>
 )}
 </Section>
 </div>
 )
}

function QAView() {
 const reconciliation = usePipelineStore(s => s.reconciliation)
 if (!reconciliation) return (
 <div className="p-8 flex flex-col items-center gap-3 text-slate-400">
 <div className="w-8 h-8 border-2 border-slate-300 border-t-emerald-500 rounded-full animate-spin" />
 <div>QA verification is running after load completes…</div>
 </div>
 )
 const match = reconciliation.match_pct
 const matchColor = match >= 99 ? 'text-emerald-700' : match >= 90 ? 'text-amber-700' : 'text-red-700'
 const checksumResults = reconciliation.checksum_results || {}
 const tableEntries = Object.entries(checksumResults)

 return (
 <div className="space-y-5">
 {/* Hero comparison */}
 <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
 <div className="px-5 py-3 border-b border-slate-200 bg-slate-50 text-sm font-bold text-slate-900">Source vs FHIR Output — Comparison</div>
 <div className="grid grid-cols-3 divide-x divide-slate-200">
 <div className="p-6 text-center">
 <div className="text-xs text-slate-500 uppercase tracking-wider mb-2">Source Records</div>
 <div className="text-4xl font-bold font-mono text-slate-900">{reconciliation.source_count.toLocaleString()}</div>
 <div className="text-xs text-slate-400 mt-1">extracted from PostgreSQL</div>
 </div>
 <div className="p-6 text-center">
 <div className="text-xs text-slate-500 uppercase tracking-wider mb-2">FHIR Output</div>
 <div className="text-4xl font-bold font-mono text-blue-700">{reconciliation.target_count.toLocaleString()}</div>
 <div className="text-xs text-slate-400 mt-1">loaded to FHIR endpoint</div>
 </div>
 <div className="p-6 text-center">
 <div className="text-xs text-slate-500 uppercase tracking-wider mb-2">Match Rate</div>
 <div className={clsx('text-4xl font-bold font-mono', matchColor)}>{match}%</div>
 <div className="text-xs text-slate-400 mt-1">{match >= 99 ? 'Perfect match' : 'Some records differ'}</div>
 </div>
 </div>
 </div>
 {/* Per-table integrity */}
 <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
 <div className="px-5 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
 <div className="text-sm font-bold text-slate-900">Data Integrity Checks</div>
 <div className="text-xs text-slate-500">Verifies each source row made it into FHIR with the expected transformation applied.</div>
 </div>
 {tableEntries.length === 0 ? (
 <div className="px-5 py-6 text-sm text-slate-500">No per-table checksum data reported.</div>
 ) : (
 <div className="divide-y divide-slate-100">
 {tableEntries.map(([table, res]) => {
 const countOk = res.count_match
 const fieldsOk = res.fields_checked === 0 ? true : res.fields_passing === res.fields_checked
 const overallOk = countOk && fieldsOk
 const failingFields = Object.entries(res.field_checksums || {}).filter(([, ok]) => !ok).map(([k]) => k)
 return (
 <div key={table} className="px-5 py-4">
 <div className="flex items-center justify-between gap-3">
 <div className="min-w-0">
 <div className="text-sm font-semibold text-slate-900">{table} <span className="text-slate-400">→</span> {res.resource_type}</div>
 <div className="text-xs text-slate-500 mt-0.5">
 {res.source_count.toLocaleString()} source rows → {res.fhir_count.toLocaleString()} FHIR resources ·
 {' '}{res.fields_passing}/{res.fields_checked} field checksums match
 </div>
 </div>
 <span className={clsx('px-3 py-1.5 rounded-xl text-xs font-bold shrink-0', overallOk ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700')}>
 {overallOk ? 'PASS' : 'FAIL'}
 </span>
 </div>
 {!overallOk && (
 <div className="mt-2 text-xs text-red-700 leading-relaxed">
 {!countOk && <div>Row count mismatch — expected {res.source_count}, loaded {res.fhir_count}.</div>}
 {failingFields.length > 0 && <div>Fields differing from source: <span className="font-mono">{failingFields.join(', ')}</span></div>}
 </div>
 )}
 </div>
 )
 })}
 </div>
 )}
 </div>
 {/* How to read this */}
 <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
 <div className="text-sm font-semibold text-slate-900 mb-2">How to read this check</div>
 <div className="text-sm text-slate-600 leading-relaxed">
 Each check hashes the source values after applying the same transformation
 the Transformation Agent applied (IDs normalized to stable UUIDs, dates
 normalized to ISO-8601, amounts normalized to numeric). A <span className="font-semibold text-emerald-700">PASS</span> means
 every source value is present in the FHIR output with the expected shape.
 A <span className="font-semibold text-red-700">FAIL</span> means a specific field diverged — the failing field names
 are listed above so you know exactly where to look.
 </div>
 </div>
 {/* Anomalies */}
 {reconciliation.anomalies_quarantined > 0 && (
 <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 shadow-sm">
 <div className="text-sm font-bold text-amber-800">{reconciliation.anomalies_quarantined} records quarantined</div>
 <div className="text-xs text-amber-700 mt-1">These records had data quality issues and were not loaded to the FHIR endpoint.</div>
 </div>
 )}
 <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
 <div className="text-sm font-semibold text-slate-900 mb-2">Summary</div>
 <div className="text-sm text-slate-600">{reconciliation.matched} records matched successfully. {reconciliation.anomalies_quarantined} quarantined. {reconciliation.violations} business rule violations.</div>
 </div>
 </div>
 )
}

function MonitorView() {
 const agents = usePipelineStore(s => s.agents)
 const monitorState = agents.monitor
 const drift = usePipelineStore(s => s.schemaDrift)
 return (
 <div className="space-y-5">
 <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
 <div className="px-5 py-3 border-b border-slate-200 bg-slate-50 text-sm font-bold text-slate-900">Schema Watch Status</div>
 <div className="divide-y divide-slate-100">
 {['members','eligibility','claims'].map(t => (
 <div key={t} className="flex items-center justify-between px-5 py-4">
 <div>
 <div className="text-sm font-medium text-slate-900 capitalize">{t}</div>
 <div className="text-xs text-slate-500 mt-0.5">Monitoring column structure every 30 seconds</div>
 </div>
 <span className={clsx('px-3 py-1.5 rounded-xl text-xs font-bold', drift ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700')}>
 {drift ? 'DRIFT DETECTED' : 'Stable'}
 </span>
 </div>
 ))}
 </div>
 </div>
 {drift ? (
 <div className="rounded-2xl border border-red-200 bg-red-50 p-5 shadow-sm">
 <div className="text-sm font-bold text-red-800 mb-2">Schema drift detected — pipeline halted</div>
 <div className="text-sm text-red-700">{drift.details}</div>
 <div className="mt-3 space-y-1">
 {drift.column_changes.map((c, i) => (
 <div key={i} className={clsx('text-xs px-3 py-1.5 rounded-lg font-mono', c.change_type === 'added' ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800')}>
 {c.change_type === 'added' ? '+' : '−'} {c.table}.{c.column}
 </div>
 ))}
 </div>
 </div>
 ) : (
 <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 shadow-sm">
 <div className="text-sm font-semibold text-emerald-800">No schema drift detected</div>
 <div className="text-xs text-emerald-700 mt-1">The source tables have maintained their structure throughout this run. Status: {monitorState.status}</div>
 </div>
 )}
 </div>
 )
}

const STAGE_SUMMARY: Record<string, { done: string; next: string }> = {
 EXTRACT: { done: 'Source data pulled from PostgreSQL', next: 'Applying FHIR field mapping to each row' },
 TRANSFORM: { done: 'All rows converted to FHIR-ready format', next: 'Validating structure and awaiting approval' },
 VALIDATE: { done: 'FHIR structure validated', next: 'Waiting for human approval before load' },
 AWAITING_APPROVAL: { done: 'Approval gate open', next: 'Once approved, resources will be sent to FHIR endpoint' },
 LOAD: { done: 'Resources posted to FHIR endpoint', next: 'QA Agent verifying source vs output counts' },
 RECONCILE: { done: 'QA complete — integrity verified', next: 'Migration finished' },
 COMPLETE: { done: 'Migration complete. All records loaded and verified.', next: '' },
 HALTED: { done: 'Pipeline was stopped.', next: 'Return to Home to start a new run.' },
}

export default function MigrationView({ onGoHome }: { onGoHome?: () => void } = {}) {
 const activeTab = usePipelineStore((s) => s.activeAgentTab)
 const setActiveTab = usePipelineStore((s) => s.setActiveAgentTab)
 const stage = usePipelineStore((s) => s.stage)
 const resetFn = usePipelineStore((s) => s.resetPipeline)
 const agents = usePipelineStore((s) => s.agents)
 const schemaMapping = usePipelineStore((s) => s.schemaMapping)
 const reconciliation = usePipelineStore((s) => s.reconciliation)
 const migrationSummary = usePipelineStore((s) => s.migrationSummary) as any
 const pendingReviewCount = usePipelineStore((s) => s.pendingReviews.length)
 const isDone = stage === 'COMPLETE' || stage === 'HALTED'
 const active = AGENTS.find(a => a.id === activeTab) || AGENTS[0]
 const activeState = agents[active.id]
 const palette = COLOR[active.color]
 // While the operator is actively resolving field reviews, keep the main
 // panel clear: the activity footer eats ~200px and can cover the last
 // review card's Accept / Edit / Reject buttons.
 const inReviewFlow = pendingReviewCount > 0 && (stage === 'TRANSFORM' || stage === 'VALIDATE' || stage === 'AWAITING_APPROVAL')

 const content = useMemo(() => {
 switch (active.id) {
 case 'discovery': return <DiscoveryView />
 case 'transformation': return <TransformationView />
 case 'orchestration': return <OrchestrationView />
 case 'qa': return <QAView />
 case 'monitor': return <MonitorView />
 default: return null
 }
 }, [active.id])

 // Build activity log: what has been confirmed at each stage
 const stageOrder = ['EXTRACT','TRANSFORM','VALIDATE','AWAITING_APPROVAL','LOAD','RECONCILE','COMPLETE']
 const currentIdx = stageOrder.indexOf(stage)
 const completedStages = stageOrder.slice(0, currentIdx)
 const stageSummary = STAGE_SUMMARY[stage]

 // Per-step quick stats for the sidebar
 const stepStats: Record<string, string> = {
 discovery: schemaMapping ? `${schemaMapping.summary.total_rows.toLocaleString()} rows · ${schemaMapping.summary.auto_mapped_fields} fields mapped` : '',
 transformation: migrationSummary?.total_loaded ? `${migrationSummary.total_loaded.toLocaleString()} FHIR records` : '',
 orchestration: migrationSummary?.total_loaded ? `Loaded to endpoint` : '',
 qa: reconciliation ? `${reconciliation.match_pct}% match rate` : '',
 monitor: agents.monitor.status === 'watching' ? 'Watching for schema drift' : agents.monitor.status,
 }

 return (
 <div className="flex flex-col h-full bg-slate-50">
 <div className="flex flex-1 gap-0 p-4 min-h-0 overflow-hidden">
 {/* Left sidebar */}
 <div className="w-72 shrink-0 flex flex-col gap-3 pr-4 border-r border-slate-200 overflow-y-auto">
 {/* Current stage card */}
 <div className={clsx('rounded-2xl p-4 shadow-sm border', stage === 'COMPLETE' ? 'border-emerald-200 bg-emerald-50' : stage === 'HALTED' ? 'border-red-200 bg-red-50' : 'border-blue-200 bg-blue-50')}>
 <div className={clsx('text-xs font-bold uppercase tracking-wider mb-1', stage === 'COMPLETE' ? 'text-emerald-600' : stage === 'HALTED' ? 'text-red-600' : 'text-blue-600')}>Current Stage</div>
 <div className="text-slate-900 font-semibold">{stage === 'AWAITING_APPROVAL' ? 'Awaiting Approval' : stage.charAt(0) + stage.slice(1).toLowerCase()}</div>
 {stageSummary && <div className="text-xs text-slate-600 mt-1">{stageSummary.done}</div>}
 {stageSummary?.next && <div className="text-xs text-blue-600 mt-2 font-medium">Next: {stageSummary.next}</div>}
 </div>

 {/* Agents */}
 <div className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold px-1">Agents</div>
 <div className="space-y-2">
 {AGENTS.map(a => {
 const c = COLOR[a.color]
 const state = agents[a.id]
 const stat = stepStats[a.id]
 const statusDot = state.status === 'success' ? 'bg-emerald-500' : state.status === 'running' ? 'bg-blue-500 animate-pulse' : state.status === 'failed' ? 'bg-red-500' : 'bg-slate-300'
 return (
 <button key={a.id} onClick={() => setActiveTab(a.id)}
 className={clsx('w-full text-left rounded-2xl border px-4 py-3.5 transition-all', activeTab === a.id ? `${c.border} ${c.panel} shadow-sm` : 'border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm')}>
 <div className="flex items-center gap-3">
 <div className={clsx('w-9 h-9 rounded-full text-sm font-bold flex items-center justify-center shrink-0', activeTab === a.id ? `${c.panel} ${c.text}` : 'bg-slate-100 text-slate-500')}>{a.num}</div>
 <div className="flex-1 min-w-0">
 <div className="flex items-center gap-2">
 <div className={clsx('text-sm font-semibold truncate', activeTab === a.id ? c.text : 'text-slate-800')}>{a.title}</div>
 <span className={clsx('w-2 h-2 rounded-full shrink-0', statusDot)} />
 </div>
 {stat && <div className="text-[11px] text-slate-500 mt-0.5 truncate">{stat}</div>}
 </div>
 </div>
 </button>
 )
 })}
 </div>
 </div>

 {/* Main content area */}
 <div className="flex-1 min-w-0 pl-4 overflow-hidden flex flex-col">
 {/* Agent header */}
 <div className={clsx('rounded-2xl border mb-3 px-5 py-4 shadow-sm', palette.border, palette.panel)}>
 <div className="flex items-start justify-between">
 <div>
 <div className={clsx('text-xs font-bold uppercase tracking-wider', palette.text)}>Agent {active.num}</div>
 <div className="text-slate-900 font-bold text-xl mt-0.5">{active.title}</div>
 <div className="text-slate-500 text-sm mt-1">{active.subtitle}</div>
 </div>
 <div className="text-right shrink-0">
 <div className={clsx('inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold',
 activeState.status === 'success' ? 'bg-emerald-100 text-emerald-700' :
 activeState.status === 'running' ? 'bg-blue-100 text-blue-700' :
 activeState.status === 'failed' ? 'bg-red-100 text-red-700' :
 'bg-slate-100 text-slate-500')}>
 {activeState.status === 'running' && <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />}
 {activeState.status === 'success' && '✓'} {activeState.status.charAt(0).toUpperCase() + activeState.status.slice(1)}
 </div>
 {isDone && (
 <button onClick={() => { resetFn(); onGoHome?.() }}
 className="mt-2 block px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs rounded-xl transition-all">
 Back to Home
 </button>
 )}
 </div>
 </div>
 </div>

 {/* Content */}
 <div className="flex-1 overflow-y-auto space-y-5 pr-0.5 pb-24">{content}</div>

 {/* Activity footer: what happened + next step.
  * Hidden while the operator is resolving field mapping reviews so the
  * Accept / Edit / Reject buttons on the last card are never clipped. */}
 {completedStages.length > 0 && !isDone && !inReviewFlow && (
 <div className="mt-3 rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden shrink-0">
 <div className="px-4 py-2.5 border-b border-slate-100 bg-slate-50 text-xs font-bold text-slate-600 uppercase tracking-wider">Activity — What has been confirmed so far</div>
 <div className="divide-y divide-slate-100">
 {completedStages.map(s => {
 const sum = STAGE_SUMMARY[s]
 if (!sum) return null
 return (
 <div key={s} className="flex items-center gap-3 px-4 py-2.5">
 <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
 <div className="flex-1">
 <span className="text-xs font-semibold text-slate-700">{s.charAt(0) + s.slice(1).toLowerCase().replace('_', ' ')}</span>
 <span className="text-xs text-slate-500 ml-2">{sum.done}</span>
 </div>
 <span className="text-[10px] text-emerald-600 font-semibold uppercase tracking-wide">Done</span>
 </div>
 )
 })}
 {stageSummary?.next && (
 <div className="flex items-center gap-3 px-4 py-2.5 bg-blue-50">
 <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse shrink-0" />
 <span className="text-xs text-blue-700 font-medium">Next: {stageSummary.next}</span>
 </div>
 )}
 </div>
 </div>
 )}

 {isDone && (
 <div className={clsx('mt-3 rounded-2xl border shadow-sm p-4 shrink-0', stage === 'COMPLETE' ? 'border-emerald-200 bg-emerald-50' : 'border-red-200 bg-red-50')}>
 <div className={clsx('text-sm font-bold mb-1', stage === 'COMPLETE' ? 'text-emerald-800' : 'text-red-800')}>
 {stage === 'COMPLETE' ? 'Migration complete' : 'Pipeline halted'}
 </div>
 <div className="text-xs text-slate-600">
 {stageOrder.filter((_, i) => i < currentIdx).map(s => STAGE_SUMMARY[s]?.done).filter(Boolean).join(' → ')}
 </div>
 </div>
 )}
 </div>
 </div>
 </div>
 )
}
