export type AgentName = 'discovery' | 'transformation' | 'orchestration' | 'qa' | 'monitor'
export type AgentStatus = 'idle' | 'running' | 'success' | 'failed' | 'watching'
export type PipelineStage =
 | 'IDLE' | 'EXTRACT' | 'TRANSFORM' | 'VALIDATE'
 | 'AWAITING_APPROVAL' | 'LOAD' | 'RECONCILE' | 'COMPLETE' | 'HALTED'

export interface AuditEntry {
 timestamp: string
 agent: string
 action: string
 status: 'success' | 'failed' | 'pending' | 'awaiting_approval'
 records_affected: number
 details: string
}

export interface ReasoningStep {
 agent: AgentName
 step: string
 detail: string
 emoji: string
 timestamp: string
}

export interface AgentState {
 name: AgentName
 status: AgentStatus
 last_action: string
 records_processed: number
 last_active: string | null
 reasoning: ReasoningStep[]
}

export interface ReconciliationReport {
 source_count: number
 target_count: number
 match_pct: number
 matched: number
 mismatched: number
 missing: number
 violations: number
 checksum_member_id: boolean
 checksum_claim_amount: boolean
 checksum_date_of_service: boolean
 anomalies_quarantined: number
 generated_at: string
}

export interface ColumnChange {
 table: string
 change_type: 'added' | 'removed' | 'renamed'
 column: string
 old_type?: string
 new_type?: string
}

export interface ApprovalGateData {
 records_to_load: number
 anomaly_count: number
 success_rate: number
 validation_passed: boolean
 waiting_since: string
}

export interface SchemaDriftData {
 column_changes: ColumnChange[]
 proposed_mapping: Record<string, string>
 details: string
}

export interface MappingCandidate {
 source_column: string
 target_field: string | null
 confidence: number
 reason: string
 sample_values?: string[]
 data_type?: string
}

export interface MappingField extends MappingCandidate {
 status: 'auto_mapped' | 'requires_review' | 'ignored'
 candidates?: MappingCandidate[]
}

export interface MappingTableSummary {
 table: string
 resource: string
 resource_confidence: number
 resource_reasoning: string[]
 resource_candidates: Record<string, number>
 fields: MappingField[]
 row_count: number
}

export interface ReviewItem {
 table: string
 record_index?: number
 resource?: string
 resource_type?: string
 source_column: string
 source_value?: string
 target_field?: string | null
 confidence: number
 reason: string
 review_decision?: 'accept' | 'reject' | 'edit'
 fields?: Array<{ source_column: string; source_value: string; candidate_target?: string; confidence: number; reason: string }>
}

export interface SchemaMapping {
 schema: Record<string, {
 row_count: number
 columns: Array<{ name: string; type: string; nullable: string; default?: string }>
 sample_rows: Record<string, unknown>[]
 }>
 mapping_summary: MappingTableSummary[]
 requires_review: Array<MappingField & { table: string; resource: string }>
 unmapped_fields: Array<MappingField & { table: string; resource: string }>
 summary: {
 tables_scanned: number
 total_columns: number
 total_rows: number
 auto_mapped_fields: number
 requires_review_fields: number
 ignored_fields: number
 }
}

export interface ComplianceRule {
 id: string
 name: string
 standard: string
 score: number
 passed: number
 total: number
 threshold: number
}

export interface ComplianceReport {
 overall_score: number
 icd10_compliance: number
 npi_validity: number
 fhir_completeness: number
 hipaa_score: number
 date_compliance: number
 gender_compliance: number
 uuid_compliance: number
 amount_validity: number
 rules: ComplianceRule[]
 summary: { passed_rules: number; total_rules: number; critical_failures: string[] }
}

export interface MigrationRun {
 run_id: string
 dataset_id: string
 dataset_name: string
 started_at: string
 completed_at: string | null
 status: string
 total_source: number
 total_loaded: number
 anomaly_count: number
 violation_count: number
 match_pct: number
 compliance_score: number
 fhir_completeness: number
 icd10_compliance: number
 npi_validity: number
 hipaa_score: number
}

export interface DatasetInfo {
 id: string
 name: string
 description: string
 badge: string
 color: string
 members: number
 eligibility: number
 claims: number
 total: number
}

export type WsEvent =
 | { type: 'AGENT_STATUS'; agent: AgentName; status: AgentStatus; last_action: string; records_processed: number; timestamp: string }
 | { type: 'AGENT_REASONING'; agent: AgentName; step: string; detail: string; emoji: string; timestamp: string }
 | { type: 'AUDIT_LOG_ENTRY'; entry: AuditEntry }
 | { type: 'PIPELINE_STAGE_CHANGE'; stage: PipelineStage; run_id: string }
 | { type: 'APPROVAL_GATE'; records_to_load: number; anomaly_count: number; success_rate: number; validation_passed: boolean; waiting_since: string }
 | { type: 'SCHEMA_DRIFT'; column_changes: ColumnChange[]; proposed_mapping: Record<string, string>; details: string }
 | { type: 'SCHEMA_MAPPING_READY'; mapping: SchemaMapping }
 | { type: 'REVIEWS_UPDATED'; pending_reviews: ReviewItem[]; schema_mapping?: SchemaMapping }
 | { type: 'RECONCILIATION_COMPLETE'; report: ReconciliationReport }
 | { type: 'COMPLIANCE_REPORT'; compliance: ComplianceReport }
 | { type: 'LOG_MESSAGE'; message: string; level: string; run_id: string; timestamp: string }
 | { type: 'RUNS_UPDATED'; runs: MigrationRun[] }
 | { type: 'MIGRATION_SUMMARY'; run_id: string; dataset_id: string; total_source: number; total_loaded: number; anomalies: number; compliance: ComplianceReport; reconciliation: ReconciliationReport; agent_outputs: Record<string, unknown> }
 | { type: 'TOAST'; message: string; level: 'info' | 'success' | 'error' | 'warning' }
