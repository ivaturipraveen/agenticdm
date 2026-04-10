import axios from 'axios'

export const API_BASE = import.meta.env.VITE_API_URL ?? ''

/** Build a full URL for fetch() calls: apiUrl('/api/datasets') */
export function apiUrl(path: string): string {
  return `${API_BASE}${path}`
}

const client = axios.create({
 baseURL: `${API_BASE}/api`,
 timeout: 30000,
})

export default client

export const startPipeline = (datasetId: string) => client.post(`/pipeline/start?dataset_id=${encodeURIComponent(datasetId)}`)
export const approvePipeline = () => client.post('/pipeline/approve')
export const haltPipeline = () => client.post('/pipeline/halt')
export const confirmDrift = () => client.post('/pipeline/confirm-drift')
export const getPipelineStatus = () => client.get('/pipeline/status')
export const getPendingReviews = () => client.get('/pipeline/reviews')
export const resolveReview = (payload: { table: string; source_column: string; decision: 'accept' | 'reject' | 'edit'; selected_target?: string }) => client.post('/pipeline/reviews/resolve', payload)
export const getAuditLog = () => client.get('/audit-log')
export const getAgentStatus = () => client.get('/agents/status')
export const getReconciliation = () => client.get('/reconciliation')
export const exportPdf = () => window.open(apiUrl('/api/audit-log/export-pdf'), '_blank')
