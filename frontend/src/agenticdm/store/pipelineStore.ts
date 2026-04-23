import { create } from 'zustand'
import toast from 'react-hot-toast'
import {
 AgentName, AgentState, AgentStatus, AuditEntry,
 ApprovalGateData, PipelineStage, ReconciliationReport,
 ReasoningStep, SchemaDriftData, SchemaMapping, WsEvent,
 ComplianceReport, MigrationRun, ReviewItem,
} from '../types/pipeline'
import {
 startPipeline, approvePipeline, haltPipeline as requestHaltPipeline, confirmDrift, resolveReview, apiUrl, getPipelineStatus,
} from '../api/client'

const DEFAULT_AGENT = (name: AgentName): AgentState => ({
 name,
 status: name === 'monitor' ? 'watching' : 'idle',
 last_action: '',
 records_processed: 0,
 last_active: null,
 reasoning: [],
})

interface PipelineStore {
 stage: PipelineStage
 runId: string | null
 agents: Record<AgentName, AgentState>
 auditLog: AuditEntry[]
 approvalGate: ApprovalGateData | null
 schemaDrift: SchemaDriftData | null
 schemaMapping: SchemaMapping | null
 reconciliation: ReconciliationReport | null
 startTime: Date | null
 driftDrawerOpen: boolean
 activeAgentTab: AgentName
 compliance: ComplianceReport | null
 selectedDatasetId: string
 logMessages: { message: string; level: string; run_id: string; timestamp: string }[]
 runs: MigrationRun[]
 migrationSummary: Record<string, unknown> | null
 pendingReviews: ReviewItem[]
 /** True from Start click until backend reports a non-IDLE stage (keeps “Starting…” after tab switch). */
 pipelineStarting: boolean
 handleWsEvent: (event: WsEvent) => void
 resolveReviewItem: (payload: { table: string; source_column: string; decision: 'accept' | 'reject' | 'edit'; selected_target?: string }) => Promise<void>
 startPipeline: () => Promise<void>
 approvePipeline: () => Promise<void>
 haltPipeline: (reason?: 'approval_reject' | 'stop') => Promise<void>
 confirmDrift: () => Promise<void>
 setDriftDrawerOpen: (open: boolean) => void
 setActiveAgentTab: (agent: AgentName) => void
 setSelectedDataset: (id: string) => void
 resetPipeline: () => Promise<void>
 hydrateApprovalGateIfMissing: () => Promise<void>
}

export const usePipelineStore = create<PipelineStore>((set, get) => ({
 stage: 'IDLE',
 runId: null,
 agents: {
 discovery: DEFAULT_AGENT('discovery'),
 transformation: DEFAULT_AGENT('transformation'),
 orchestration: DEFAULT_AGENT('orchestration'),
 qa: DEFAULT_AGENT('qa'),
 monitor: DEFAULT_AGENT('monitor'),
 },
 auditLog: [],
 approvalGate: null,
 schemaDrift: null,
 schemaMapping: null,
 reconciliation: null,
 compliance: null,
 selectedDatasetId: 'synthea_standard',
 logMessages: [],
 runs: [],
 migrationSummary: null,
 pendingReviews: [],
 pipelineStarting: false,
 startTime: null,
 driftDrawerOpen: false,
 activeAgentTab: 'discovery',

 handleWsEvent: (event: WsEvent) => {
 switch (event.type) {
 case 'AGENT_STATUS': {
 set((s) => ({
 agents: {
 ...s.agents,
 [event.agent]: {
 ...s.agents[event.agent],
 status: event.status as AgentStatus,
 last_action: event.last_action,
 records_processed: event.records_processed,
 last_active: event.timestamp,
 },
 },
 }))
 break
 }
 case 'AGENT_REASONING': {
 const step: ReasoningStep = {
 agent: event.agent,
 step: event.step,
 detail: event.detail,
 emoji: event.emoji,
 timestamp: event.timestamp,
 }
 set((s) => ({
 agents: {
 ...s.agents,
 [event.agent]: {
 ...s.agents[event.agent],
 reasoning: [...s.agents[event.agent].reasoning, step],
 },
 },
 }))
 break
 }
 case 'AUDIT_LOG_ENTRY': {
 set((s) => ({ auditLog: [event.entry, ...s.auditLog] }))
 break
 }
 case 'PIPELINE_STAGE_CHANGE': {
 const wasIdle = get().stage === 'IDLE'
 const isStarting = event.stage !== 'IDLE' && wasIdle && !!event.run_id
 set((s) => ({
 stage: event.stage,
 runId: event.run_id || s.runId,
 startTime: isStarting ? new Date() : s.startTime,
 pipelineStarting: event.stage !== 'IDLE' ? false : s.pipelineStarting,
 // Only clear approval gate once we've moved past it (LOAD stage or beyond)
 approvalGate: ['LOAD','RECONCILE','COMPLETE','HALTED'].includes(event.stage) ? null : s.approvalGate,
 }))
 if (event.stage === 'AWAITING_APPROVAL') {
 // WS can drop APPROVAL_GATE under Vite proxy; REST snapshot + delayed fetch covers the gap
 void get().hydrateApprovalGateIfMissing()
 setTimeout(() => void get().hydrateApprovalGateIfMissing(), 400)
 }
 break
 }
 case 'APPROVAL_GATE': {
 set({
 approvalGate: {
 records_to_load: event.records_to_load,
 anomaly_count: event.anomaly_count,
 success_rate: event.success_rate,
 validation_passed: event.validation_passed,
 waiting_since: event.waiting_since,
 },
 activeAgentTab: 'orchestration',
 })
 break
 }
 case 'SCHEMA_DRIFT': {
 set({ schemaDrift: { column_changes: event.column_changes, proposed_mapping: event.proposed_mapping, details: event.details } })
 break
 }
 case 'SCHEMA_MAPPING_READY': {
 set({ schemaMapping: event.mapping as SchemaMapping })
 break
 }
 case 'REVIEWS_UPDATED': {
 set((s) => ({ pendingReviews: event.pending_reviews as ReviewItem[], schemaMapping: (event.schema_mapping as SchemaMapping) || s.schemaMapping }))
 break
 }
 case 'RECONCILIATION_COMPLETE': {
 set({ reconciliation: event.report, activeAgentTab: 'qa' })
 break
 }
 case 'COMPLIANCE_REPORT': {
 set({ compliance: event.compliance as ComplianceReport })
 break
 }
 case 'LOG_MESSAGE': {
 set((s) => ({ logMessages: [...s.logMessages, { message: event.message, level: event.level, run_id: event.run_id, timestamp: event.timestamp }] }))
 break
 }
 case 'RUNS_UPDATED': {
 set({ runs: event.runs as MigrationRun[] })
 break
 }
 case 'MIGRATION_SUMMARY': {
 // Pipeline done — move back to IDLE so selection screen shows
 set({ migrationSummary: event as unknown as Record<string, unknown>, pipelineStarting: false })
 break
 }
 case 'TOAST': {
 const msg = event.message
 switch (event.level) {
 case 'success': toast.success(msg, { duration: 4000 }); break
 case 'error': toast.error(msg, { duration: 6000 }); break
 case 'warning': toast(msg, { icon: '', duration: 5000 }); break
 default: toast(msg, { duration: 3000 })
 }
 break
 }
 }
 },

 startPipeline: async () => {
 // Reset reasoning for all agents
 set((s) => ({
 auditLog: [],
 reconciliation: null,
 compliance: null,
 schemaDrift: null,
 approvalGate: null,
 schemaMapping: null,
 logMessages: [],
 startTime: new Date(),
 pipelineStarting: true,
 activeAgentTab: 'discovery',
 agents: (Object.fromEntries(
 Object.entries(s.agents).map(([k, v]) => [k, { ...v, reasoning: [], records_processed: 0, status: k === 'monitor' ? 'watching' : 'idle' as AgentStatus, last_action: '' }])
 ) as unknown) as Record<AgentName, AgentState>,
 }))
 const dsId = get().selectedDatasetId
 try {
 await startPipeline(dsId)
 toast(' Migration pipeline started!', { duration: 3000 })
 } catch (e) {
 set({ pipelineStarting: false })
 toast.error('Could not start pipeline — check backend logs')
 console.error(e)
 }
 },

 approvePipeline: async () => {
 try {
 await approvePipeline()
 set({ approvalGate: null })
 toast.success(' Approved — loading records to FHIR')
 } catch (e) {
 toast.error('Approval failed — please try again')
 console.error('Approve error:', e)
 }
 },

 haltPipeline: async (reason) => {
 try {
 await requestHaltPipeline()
 set({ approvalGate: null })
 if (reason === 'approval_reject') {
 toast('FHIR load rejected — run saved as halted (audit log updated)', { icon: '', duration: 5000 })
 } else {
 toast.error('Pipeline halted')
 }
 } catch (e) {
 toast.error('Halt failed — please try again')
 }
 },

 confirmDrift: async () => {
 set({ schemaDrift: null })
 await confirmDrift()
 toast('Schema drift acknowledged — resuming', { icon: '' })
 },

 resolveReviewItem: async (payload) => {
 await resolveReview(payload)
 },

 resetPipeline: async () => {
 await fetch(apiUrl('/api/pipeline/reset'), { method: 'POST' })
 set((s) => ({
 stage: 'IDLE',
 runId: null,
 startTime: null,
 auditLog: [],
 reconciliation: null,
 approvalGate: null,
 schemaDrift: null,
 schemaMapping: null,
 pendingReviews: [],
 pipelineStarting: false,
 activeAgentTab: 'discovery',
 agents: (Object.fromEntries(
 Object.entries(s.agents).map(([k, v]) => [k, { ...v, reasoning: [], records_processed: 0, status: k === 'monitor' ? 'watching' : 'idle' as AgentStatus, last_action: '' }])
 ) as unknown) as Record<AgentName, AgentState>,
 }))
 },

 setDriftDrawerOpen: (open) => set({ driftDrawerOpen: open }),
 setActiveAgentTab: (agent) => set({ activeAgentTab: agent }),
 setSelectedDataset: (id) => set({ selectedDatasetId: id }),

 hydrateApprovalGateIfMissing: async () => {
 if (get().approvalGate) return
 if (get().stage !== 'AWAITING_APPROVAL') return
 try {
 const { data } = await getPipelineStatus()
 const g = (data as { stage?: string; approval_gate?: Record<string, unknown> | null }).approval_gate
 if (data.stage === 'AWAITING_APPROVAL' && g && typeof g.records_to_load === 'number') {
 set({
 approvalGate: {
 records_to_load: g.records_to_load,
 anomaly_count: Number(g.anomaly_count ?? 0),
 success_rate: Number(g.success_rate ?? 0),
 validation_passed: Boolean(g.validation_passed),
 waiting_since: String(g.waiting_since ?? ''),
 },
 activeAgentTab: 'orchestration',
 })
 }
 } catch {
 /* ignore */
 }
 },
}))
