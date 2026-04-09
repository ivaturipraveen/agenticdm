import { useMemo, useState } from 'react'
import clsx from 'clsx'
import { usePipelineStore } from '../store/pipelineStore'
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
 const pendingReviews = usePipelineStore(s => s.pendingReviews)
 if (!schemaMapping) return <div className="text-slate-500">Discovery has not produced output yet.</div>
 return (
 <div className="space-y-5">
 <div className="grid grid-cols-4 gap-4">
 <MetricCard label="Tables scanned" value={schemaMapping.summary.tables_scanned} />
 <MetricCard label="Source rows" value={schemaMapping.summary.total_rows.toLocaleString()} />
 <MetricCard label="Auto-mapped fields" value={schemaMapping.summary.auto_mapped_fields} tone="text-emerald-700" />
 <MetricCard label="Review fields" value={schemaMapping.summary.requires_review_fields} tone="text-amber-700" />
 </div>
 <Section title="What this agent is doing" subtitle="Discovery reads source tables, identifies likely FHIR resources, and proposes source-to-target mappings.">
 <div className="grid grid-cols-1 gap-4">{schemaMapping.mapping_summary.map((table) => <MappingTableCard key={table.table} table={table} />)}</div>
 </Section>
 <Section title="Review-required mappings" subtitle="These mappings are uncertain and can be accepted, rejected, or edited before the pipeline continues.">
 {pendingReviews.length === 0 ? <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-500 shadow-sm">No unresolved review items.</div> : <div className="space-y-3">{pendingReviews.map((item, idx) => <ReviewCard key={`${item.table}-${item.source_column}-${idx}`} item={item} />)}</div>}
 </Section>
 <TechnicalDetails title="Discovery technical details" data={schemaMapping} />
 </div>
 )
}

function TransformationView() {
 const migrationSummary = usePipelineStore(s => s.migrationSummary) as any
 const pendingReviews = usePipelineStore(s => s.pendingReviews)
 const fhirSamples = migrationSummary?.agent_outputs?.fhir_samples || []
 const validationErrors = migrationSummary?.agent_outputs?.validation_errors || []
 const reviewItems = migrationSummary?.agent_outputs?.review_items || []
 return (
 <div className="space-y-5">
 <div className="grid grid-cols-4 gap-4">
 <MetricCard label="Source rows processed" value={migrationSummary?.total_source ?? 0} />
 <MetricCard label="FHIR rows produced" value={migrationSummary?.total_loaded ?? 0} tone="text-violet-700" />
 <MetricCard label="Review items" value={reviewItems.length} tone="text-amber-700" />
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
 <Section title="Review-required items" subtitle="Mappings or conversions that still need an operator decision.">
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
 const approvalGate = usePipelineStore(s => s.approvalGate)
 const stage = usePipelineStore(s => s.stage)
 const counts = migrationSummary?.agent_outputs?.resource_counts || {}
 const fhirSamples = migrationSummary?.agent_outputs?.fhir_samples || []
 const validationErrors = migrationSummary?.agent_outputs?.validation_errors || []
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
 <MetricCard label="Records ready" value={approvalGate?.records_to_load ?? migrationSummary?.total_loaded ?? 0} />
 <MetricCard label="Validation issues" value={validationErrors.length} tone={validationErrors.length ? 'text-red-700' : 'text-emerald-700'} />
 <MetricCard label="Approval state" value={stage === 'AWAITING_APPROVAL' ? 'Waiting' : stage === 'LOAD' || stage === 'RECONCILE' || stage === 'COMPLETE' ? 'Approved' : 'Pending'} tone={stage === 'AWAITING_APPROVAL' ? 'text-amber-700' : 'text-emerald-700'} />
 <MetricCard label="Target batches" value={Object.keys(counts).length} tone="text-cyan-700" />
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

 <Section title="Load summary" subtitle="Resources prepared for target delivery and post-load handoff.">
 <div className="grid grid-cols-3 gap-4">{Object.entries(counts).map(([k, v]) => <MetricCard key={k} label={k} value={v as number} tone="text-cyan-700" />)}</div>
 </Section>

 <Section title="Approval and handoff" subtitle="Shows the gate status before load and the transition into QA after load completes.">
 <div className="grid grid-cols-2 gap-4">
 <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className="text-sm font-semibold text-slate-900 mb-2">Approval Gate</div><div className="text-sm text-slate-700 leading-relaxed">{approvalGate ? `Waiting to load ${approvalGate.records_to_load} records with ${approvalGate.anomaly_count} flagged anomalies at ${approvalGate.success_rate}% success rate.` : 'No active approval gate right now.'}</div></div>
 <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className="text-sm font-semibold text-slate-900 mb-2">QA Handoff</div><div className="text-sm text-slate-700 leading-relaxed">After load, Orchestration hands the final output counts and loaded resources to the QA / Reconciliation Agent for integrity checks.</div></div>
 </div>
 </Section>

 <Section title="Target delivery samples" subtitle="Examples of the FHIR-ready data sent during load.">
 <div className="grid grid-cols-2 gap-4">{fhirSamples.slice(0, 2).map((sample: unknown, idx: number) => <div key={idx} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className="text-sm font-semibold text-slate-900 mb-2">Loaded sample {idx + 1}</div><pre className="text-xs text-slate-700 whitespace-pre-wrap overflow-x-auto">{JSON.stringify(sample, null, 2)}</pre></div>)}</div>
 </Section>

 <TechnicalDetails title="Orchestration technical details" data={migrationSummary?.agent_outputs || {}} />
 </div>
 )
}

function QAView() {
 const reconciliation = usePipelineStore(s => s.reconciliation)
 if (!reconciliation) return <div className="text-slate-500">QA output not available yet.</div>
 return (
 <div className="space-y-5">
 <div className="grid grid-cols-4 gap-4">
 <MetricCard label="Source rows" value={reconciliation.source_count} />
 <MetricCard label="Output rows" value={reconciliation.target_count} />
 <MetricCard label="Match rate" value={`${reconciliation.match_pct}%`} tone="text-emerald-700" />
 <MetricCard label="Anomalies quarantined" value={reconciliation.anomalies_quarantined} tone="text-amber-700" />
 </div>
 <Section title="What this agent is doing" subtitle="QA compares the original source volume with the final generated output and checks for gaps or mismatches.">
 <div className="grid grid-cols-2 gap-4">
 <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><div className="text-sm font-semibold text-slate-900 mb-2">Input</div><div className="text-sm text-slate-600">Source counts and loaded resource counts.</div></div>
 <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><div className="text-sm font-semibold text-slate-900 mb-2">Output</div><div className="text-sm text-slate-600">Match rate, violations, checksum signals, and anomaly summary.</div></div>
 </div>
 </Section>
 <TechnicalDetails title="QA technical details" data={reconciliation} />
 </div>
 )
}

function MonitorView() {
 return (
 <div className="space-y-5">
 <Section title="What this agent is doing" subtitle="The monitor watches the source schema in the background to ensure the pipeline is not working against a moving target.">
 <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-700 shadow-sm">If a source table changes structure during the run, this agent can raise a drift warning and stop execution for review.</div>
 </Section>
 </div>
 )
}

export default function MigrationView() {
 const activeTab = usePipelineStore((s) => s.activeAgentTab)
 const setActiveTab = usePipelineStore((s) => s.setActiveAgentTab)
 const stage = usePipelineStore((s) => s.stage)
 const resetFn = usePipelineStore((s) => s.resetPipeline)
 const agents = usePipelineStore((s) => s.agents)
 const isDone = stage === 'COMPLETE' || stage === 'HALTED'
 const active = AGENTS.find(a => a.id === activeTab) || AGENTS[0]
 const activeState = agents[active.id]
 const palette = COLOR[active.color]

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

 return (
 <div className="flex flex-col h-full bg-slate-100">
 {isDone && <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-200 bg-white shrink-0"><div className={clsx('text-sm font-semibold', stage === 'COMPLETE' ? 'text-emerald-700' : 'text-red-700')}>{stage === 'COMPLETE' ? 'Run complete' : 'Pipeline halted'}</div><button onClick={resetFn} className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white font-semibold text-sm rounded-lg transition-all">New Run</button></div>}
 <div className="flex flex-1 gap-0 p-4 min-h-0">
 <div className="w-80 shrink-0 border-r border-slate-200 pr-3 overflow-y-auto">
 <div className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold px-2 pb-2">Agents</div>
 <div className="space-y-2">
 {AGENTS.map(a => {
 const c = COLOR[a.color]
 const state = agents[a.id]
 return <button key={a.id} onClick={() => setActiveTab(a.id)} className={clsx('w-full text-left rounded-xl border px-3 py-3 transition-all shadow-sm', activeTab === a.id ? `${c.border} ${c.panel}` : 'border-slate-200 bg-white hover:border-slate-300')}><div className="flex items-center gap-3"><div className="w-9 h-9 rounded-full bg-slate-200 text-slate-800 text-sm font-bold flex items-center justify-center">{a.num}</div><div className="flex-1"><div className={clsx('text-sm font-semibold', activeTab === a.id ? c.text : 'text-slate-900')}>Agent {a.num} — {a.title}</div><div className="text-[11px] text-slate-500 mt-0.5">{a.subtitle}</div><div className="text-[10px] text-slate-500 mt-1">Status: {state.status}</div></div></div></button>
 })}
 </div>
 </div>
 <div className="flex-1 min-w-0 pl-4 overflow-hidden">
 <div className="h-full bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col shadow-sm">
 <div className={clsx('px-5 py-4 border-b border-slate-200 shrink-0', palette.soft)}>
 <div className="flex items-center justify-between gap-4">
 <div>
 <div className={clsx('text-sm font-semibold', palette.text)}>Agent {active.num}</div>
 <div className="text-slate-900 font-bold text-xl">{active.title}</div>
 <div className="text-slate-600 text-sm mt-1">{active.subtitle}</div>
 </div>
 <div className="text-right">
 <div className="text-xs text-slate-500">Pipeline stage</div>
 <div className="text-slate-900 font-semibold">{stage}</div>
 </div>
 </div>
 </div>
 <div className="flex-1 overflow-y-auto p-5 space-y-5 bg-slate-50/50">{content}</div>
 </div>
 </div>
 </div>
 </div>
 )
}
