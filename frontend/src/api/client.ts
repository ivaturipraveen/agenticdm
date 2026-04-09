import axios from 'axios'

const client = axios.create({
 baseURL: '/api',
 timeout: 30000,
})

export default client

export const startPipeline = (datasetId: string = 'synthea_standard') => client.post(`/pipeline/start?dataset_id=${datasetId}`)
export const approvePipeline = () => client.post('/pipeline/approve')
export const haltPipeline = () => client.post('/pipeline/halt')
export const confirmDrift = () => client.post('/pipeline/confirm-drift')
export const getPipelineStatus = () => client.get('/pipeline/status')
export const getPendingReviews = () => client.get('/pipeline/reviews')
export const resolveReview = (payload: { table: string; source_column: string; decision: 'accept' | 'reject' | 'edit'; selected_target?: string }) => client.post('/pipeline/reviews/resolve', payload)
export const getAuditLog = () => client.get('/audit-log')
export const getAgentStatus = () => client.get('/agents/status')
export const getReconciliation = () => client.get('/reconciliation')
export const exportPdf = () => window.open('/api/audit-log/export-pdf', '_blank')
