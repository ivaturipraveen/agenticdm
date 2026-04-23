import axios from 'axios'
import { API_BASE } from '../config'
import { authHeaders } from '../shell/auth'

const client = axios.create({
  baseURL: `${API_BASE}/api/lacare`,
  timeout: 60000,
})
client.interceptors.request.use((cfg) => {
  cfg.headers = { ...(cfg.headers || {}), ...authHeaders() } as any
  return cfg
})

export interface LaCareAgent {
  status: 'idle' | 'running' | 'complete' | 'failed' | 'processing'
  processed: number
  last_action: string
  duration_ms: number
}

export interface LaCareStatus {
  run_id: string
  status: 'idle' | 'running' | 'complete' | 'halted' | 'failed' | 'queued'
  started_at: string
  completed_at: string
  total_documents: number
  processed_documents: number
  current_stage: string
  agents: Record<string, LaCareAgent>
  measure_counts: Record<string, number>
  revenue: { total_usd: number; by_measure: Record<string, { count: number; amount: number; name: string }> }
  gaps_closed: number
  warnings: string[]
  logs: { ts: string; level: string; message: string; meta: Record<string, any> }[]
}

export interface LaCareMeasureInfo {
  name: string
  description: string
  window_days: number
  priority: string
}

export interface LaCareDashboard {
  total_documents: number
  total_evidence: number
  gap_closure_members: number
  by_measure: Record<string, { code: string; name: string; description: string; count: number; priority: string }>
  by_document_type: Record<string, number>
  by_scenario: Record<string, number>
  confidence_buckets: Record<string, number>
  revenue: { total_usd: number; by_measure: Record<string, { count: number; amount: number; name: string }> }
  run_id: string
  status: string
}

export interface LaCareHit {
  measure: string
  measure_name: string
  patient_id: string
  patient_name: string
  satisfied: boolean
  confidence: number
  evidence_type: string
  source_document_id: string
  source_document_type: string
  source_section: string
  summary: string
  numerator_date: string
  denominator_date: string
  document_scenario?: string
  [k: string]: any
}

export interface LaCareDocument {
  document_id: string
  document_type: string
  patient_id: string
  patient_name: string
  facility: string
  encounter_date: string
  sections: string[]
  entry_count: number
  narrative_chars: number
  scenario: string
  warnings: string[]
  uploaded_at?: string
}

export interface LaCareRun {
  run_id: string
  status: string
  started_at: string
  completed_at?: string
  total_documents: number
  processed_documents: number
  source: string
  hit_count: number
  notes?: string
}

export interface LaCareSample {
  sample_id: string
  scenario: string
  scenario_label: string
  document_type: string
  patient_id: string
  patient_name: string
  facility: string
  encounter_date: string
  section_count: number
  entry_count: number
  narrative_chars: number
  expected_measure: string
  summary: string
}

export interface LaCareSampleFacet {
  scenario: string
  scenario_label: string
  document_type: string
  count: number
}

export interface LaCareStepEvent {
  id: number
  run_id: string
  document_id: string
  agent: string
  step_label: string
  status: string
  input_summary: string
  output_summary: string
  details: Record<string, any>
  duration_ms: number
  created_at: string
}

export interface LaCareActivity {
  ts: string
  kind: string
  method: string
  path: string
  status: number
  duration_ms: number
  actor: string
  message: string
}

export interface LaCareActiveRun {
  active: boolean
  run: LaCareRun | null
}

export const getMeasures = () => client.get<Record<string, LaCareMeasureInfo>>('/measures').then(r => r.data)
export const getStatus = (run_id?: string) =>
  client.get<LaCareStatus>('/status', { params: run_id ? { run_id } : {} }).then(r => r.data)
export const getDashboard = (run_id?: string) =>
  client.get<LaCareDashboard>('/dashboard', { params: run_id ? { run_id } : {} }).then(r => r.data)
export const listRuns = () =>
  client.get<{ items: LaCareRun[] }>('/runs').then(r => r.data)
export const getDocuments = (params: { run_id?: string; limit?: number; offset?: number; search?: string; scenario?: string } = {}) =>
  client.get<{ total: number; items: LaCareDocument[] }>('/documents', { params }).then(r => r.data)
export const getDocument = (document_id: string) =>
  client.get(`/documents/${encodeURIComponent(document_id)}`).then(r => r.data)
export const getDocumentXml = (document_id: string) =>
  client.get<string>(`/documents/${encodeURIComponent(document_id)}/xml`, { responseType: 'text' }).then(r => r.data)
export const getEvidence = (params: { run_id?: string; measure?: string; patient_id?: string; limit?: number } = {}) =>
  client.get<{ total: number; items: LaCareHit[] }>('/evidence', { params }).then(r => r.data)

export const seedDemoBatch = (count: number, use_ai = true) =>
  client.post<{ status: string; run_id: string; inserted: number }>('/pipeline/seed-demo', { count, use_ai }).then(r => r.data)

export const startPipeline = (run_id: string, use_ai = true) =>
  client.post('/pipeline/start', { run_id, use_ai }).then(r => r.data)

export const resetPipeline = (run_id: string) =>
  client.post('/pipeline/reset', { run_id }).then(r => r.data)

export const cancelPipeline = (run_id?: string) =>
  client.post<{ status: string; run_id: string; cancelled_task: boolean }>(
    '/pipeline/cancel', run_id ? { run_id } : {},
  ).then(r => r.data)

export const uploadCcdaFiles = async (files: File[], run_id?: string) => {
  const form = new FormData()
  files.forEach((f) => form.append('files', f))
  const url = run_id ? `/documents/upload?run_id=${encodeURIComponent(run_id)}` : '/documents/upload'
  const { data } = await client.post<{ run_id: string; inserted: number; errors: any[]; new_run: boolean }>(
    url,
    form,
    { headers: { 'Content-Type': 'multipart/form-data' } },
  )
  return data
}

export const getSample = (scenario = 'FUM_CLOSED') =>
  client.get<{ metadata: any; xml: string; parsed: any; hits: LaCareHit[] }>('/sample', { params: { scenario } }).then(r => r.data)
export const previewUpload = (xml: string) =>
  client.post('/documents/preview', { xml }).then(r => r.data)

// ---- Sample library --------------------------------------------------------
export interface SampleListResponse {
  total: number
  items: LaCareSample[]
  facets: LaCareSampleFacet[]
  seeded: number
}
export const listSamples = (params: { scenario?: string; document_type?: string; search?: string; limit?: number; offset?: number } = {}) =>
  client.get<SampleListResponse>('/samples', { params }).then(r => r.data)
export const getSampleXml = (sample_id: string) =>
  client.get<string>(`/samples/${encodeURIComponent(sample_id)}/xml`, { responseType: 'text' }).then(r => r.data)

export interface LaCareSamplePreview {
  sample_id: string
  scenario: string
  scenario_label: string
  document_type: string
  patient: Record<string, any>
  encounter: Record<string, any>
  expected_measure: string
  summary: string
  sections: {
    name: string
    entry_count: number
    narrative_chars: number
    narrative_excerpt: string
    sample_entries: {
      display: string; code: string; code_system: string; value: string; unit: string; effective_time: string
    }[]
  }[]
  total_entries: number
  total_narrative_chars: number
  expected_hits_preview: LaCareHit[]
}
export const getSamplePreview = (sample_id: string) =>
  client.get<LaCareSamplePreview>(`/samples/${encodeURIComponent(sample_id)}/preview`).then(r => r.data)

export const runFromSamples = (sample_ids: string[], opts: { use_ai?: boolean; auto_start?: boolean } = {}) =>
  client.post<{ status: string; run_id: string; inserted: number; use_ai: boolean }>('/pipeline/from-samples', {
    sample_ids, use_ai: opts.use_ai ?? true, auto_start: opts.auto_start ?? true,
  }).then(r => r.data)

export const adminWipeRuns = () =>
  client.post<{ status: string; counts: Record<string, number> }>('/admin/wipe-runs').then(r => r.data)

// ---- Per-document steps + activity + active-run probe ---------------------
export const getDocumentSteps = (document_id: string, run_id?: string) =>
  client.get<{ items: LaCareStepEvent[]; run_id: string; document_id: string }>(
    `/documents/${encodeURIComponent(document_id)}/steps`,
    { params: run_id ? { run_id } : {} },
  ).then(r => r.data)
export const getRunSteps = (run_id?: string, agent?: string, limit = 200) =>
  client.get<{ items: LaCareStepEvent[]; run_id: string }>(
    '/steps', { params: { run_id, agent, limit } },
  ).then(r => r.data)
export const getActivity = (limit = 120) =>
  client.get<{ items: LaCareActivity[] }>('/activity', { params: { limit } }).then(r => r.data)
export const getActiveRun = () =>
  client.get<LaCareActiveRun>('/pipeline/active').then(r => r.data)
