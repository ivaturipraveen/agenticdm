import { useState } from 'react'
import { LaCareAgent, LaCareStatus } from '../api'

interface Props {
  status: LaCareStatus | null
  onRunPipeline: () => void
  onReset: () => void
  onCancel?: () => void
  canceling?: boolean
}

const AGENTS = [
  { key: 'ingest', title: 'Ingest', tag: 'Discovery', summary: 'Accepts bulk CCD/CDA XML. Handles malformed docs, missing sections.' },
  { key: 'extraction', title: 'Extraction', tag: 'Parser', summary: 'Parses urn:hl7-org:v3 XML. Extracts header + LOINC-coded sections.' },
  { key: 'normalization', title: 'Normalization', tag: 'Value Sets', summary: 'Maps ICD-9→ICD-10, local→SNOMED, proprietary→LOINC.' },
  { key: 'nlp', title: 'Narrative NLP', tag: 'Clinical LLM', summary: 'Pulls clinical facts from narrative text when structured entries are absent.' },
  { key: 'hedis', title: 'HEDIS Matching', tag: 'Rules Engine', summary: 'Matches against NCQA value sets: FUM, FUA, CBP, HBD, MRP.' },
  { key: 'dashboard', title: 'Dashboard', tag: 'Rollup', summary: 'Aggregates evidence, computes gap closure + revenue impact.' },
]

export default function PipelineTab({ status, onRunPipeline, onReset, onCancel, canceling }: Props) {
  // Display-only controls kept for the cinematic look; the real run
  // parameters are driven by the active run (set from the Overview tab
  // via Seed-Demo or Upload). This tab just lets you re-kick the pipeline.
  const [batchSize, _setBatchSize] = useState(status?.total_documents || 0)
  const [useAi, _setUseAi] = useState(true)
  void batchSize; void useAi

  const isRunning = status?.status === 'running' || status?.status === 'queued'
  const hasDocs = (status?.total_documents || 0) > 0

  return (
    <div className="p-8 max-w-[1400px] mx-auto">
      <div className="mb-8 grid md:grid-cols-3 gap-4 items-stretch">
        <div className="md:col-span-2 p-6 rounded-2xl bg-white border border-slate-200">
          <div className="flex items-center gap-2 text-[10px] font-bold tracking-widest uppercase text-rose-600">
            <span className="h-2 w-2 rounded-full bg-rose-500" />
            Agentic CCDA Pipeline
          </div>
          <h2 className="text-xl font-semibold text-slate-900 mt-1">Process a batch of C-CDA documents</h2>
          <p className="text-sm text-slate-500 mt-1">Same agent orchestration framework as the Agentic DM platform, adapted for clinical document intelligence.</p>

          <div className="mt-5 flex flex-wrap items-center gap-3 text-sm">
            <div className="px-3 py-1.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-700">
              <span className="text-xs text-slate-500">Documents in run:</span>{' '}
              <span className="font-semibold">{status?.total_documents ?? 0}</span>
            </div>
            <div className="flex-1" />
            <button
              onClick={onRunPipeline}
              disabled={isRunning || !hasDocs}
              className="px-5 py-2.5 rounded-xl bg-rose-600 text-white font-semibold text-sm hover:bg-rose-500 disabled:opacity-50 disabled:cursor-not-allowed"
              title={!hasDocs ? 'Seed or upload CCDAs first (Overview tab)' : ''}
            >
              {isRunning ? 'Running…' : 'Re-run pipeline'}
            </button>
            {isRunning && onCancel && (
              <button
                onClick={onCancel}
                disabled={canceling}
                className="px-4 py-2.5 rounded-xl bg-red-600 text-white font-semibold text-sm hover:bg-red-500 disabled:opacity-60 disabled:cursor-not-allowed"
                title="Halt the currently running pipeline"
              >
                {canceling ? 'Cancelling…' : '■ Cancel run'}
              </button>
            )}
            <button
              onClick={onReset}
              disabled={isRunning}
              className="px-4 py-2.5 rounded-xl border border-slate-200 text-slate-600 font-medium text-sm hover:bg-slate-50 disabled:opacity-60"
            >
              Delete run
            </button>
          </div>
        </div>

        <div className="p-6 rounded-2xl bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white">
          <div className="text-[10px] font-bold tracking-widest uppercase text-slate-400">Live progress</div>
          <div className="mt-2 text-3xl font-semibold">
            {status ? `${status.processed_documents.toLocaleString()} / ${status.total_documents.toLocaleString()}` : '0 / 0'}
          </div>
          <div className="text-xs text-slate-400 mt-1">documents processed</div>
          <div className="mt-4 h-2 w-full bg-slate-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-rose-500 to-rose-400 transition-all duration-500"
              style={{ width: `${status && status.total_documents > 0 ? (status.processed_documents / status.total_documents) * 100 : 0}%` }}
            />
          </div>
          {status?.current_stage && (
            <div className="mt-4 text-xs text-slate-300">
              Current stage: <span className="font-mono text-rose-300">{status.current_stage}</span>
            </div>
          )}
        </div>
      </div>

      <section className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
        {AGENTS.map((a, idx) => {
          const data: LaCareAgent = status?.agents?.[a.key] ?? {
            status: 'idle', processed: 0, last_action: '', duration_ms: 0,
          }
          const state = data.status
          return (
            <div
              key={a.key}
              className={`relative p-5 rounded-2xl bg-white border transition-all
                ${state === 'running' ? 'border-rose-300 shadow-lg shadow-rose-100' :
                  state === 'complete' ? 'border-emerald-300' :
                  state === 'failed' ? 'border-red-300' :
                  'border-slate-200'}`}
            >
              <div className={`absolute -top-3 left-4 h-6 w-6 rounded-full flex items-center justify-center text-[11px] font-bold
                ${state === 'running' ? 'bg-rose-600 text-white animate-pulse' :
                  state === 'complete' ? 'bg-emerald-500 text-white' :
                  state === 'failed' ? 'bg-red-500 text-white' :
                  'bg-slate-200 text-slate-600'}`}>
                {idx + 1}
              </div>
              <div className="flex items-start justify-between mb-2 ml-8">
                <div>
                  <div className="text-base font-semibold text-slate-900">{a.title}</div>
                  <div className="text-[10px] font-bold tracking-widest uppercase text-slate-500">{a.tag}</div>
                </div>
                <span className={`text-[10px] font-bold tracking-widest uppercase px-2 py-0.5 rounded-full
                  ${state === 'running' ? 'bg-rose-50 text-rose-700' :
                    state === 'complete' ? 'bg-emerald-50 text-emerald-700' :
                    state === 'failed' ? 'bg-red-50 text-red-700' :
                    'bg-slate-100 text-slate-500'}`}>
                  {state}
                </span>
              </div>
              <p className="text-xs text-slate-500 leading-relaxed ml-8 mb-3">{a.summary}</p>
              {data.last_action && (
                <div className="ml-8 text-xs font-mono text-slate-700 bg-slate-50 rounded-md px-2.5 py-2 border border-slate-200 leading-relaxed">
                  {data.last_action}
                </div>
              )}
              <div className="ml-8 mt-3 flex items-center justify-between text-xs text-slate-500">
                <span>Processed: <strong className="text-slate-800">{data.processed}</strong></span>
                {data.duration_ms > 0 && <span>Duration: <strong className="text-slate-800">{data.duration_ms} ms</strong></span>}
              </div>
            </div>
          )
        })}
      </section>

      <section className="mt-8 p-5 rounded-2xl bg-slate-950 text-slate-100 font-mono text-xs overflow-hidden">
        <div className="flex items-center justify-between mb-3">
          <span className="text-slate-400 tracking-wider text-[10px] uppercase">Pipeline Log</span>
          <span className="text-slate-500 text-[10px]">{status?.logs?.length ?? 0} events</span>
        </div>
        <div className="max-h-80 overflow-auto space-y-1 pr-2">
          {(status?.logs ?? []).slice().reverse().map((log, i) => (
            <div key={i} className="flex items-start gap-3 leading-relaxed">
              <span className="text-slate-500 text-[10px] mt-0.5">{log.ts.slice(11, 19)}</span>
              <span className={`text-[10px] uppercase tracking-wider font-bold min-w-[50px]
                ${log.level === 'success' ? 'text-emerald-400' :
                  log.level === 'error' ? 'text-rose-400' :
                  log.level === 'warn' ? 'text-amber-400' :
                  'text-sky-300'}`}>
                {log.level}
              </span>
              <span className="text-slate-200">{log.message}</span>
            </div>
          ))}
          {(!status?.logs || status.logs.length === 0) && (
            <div className="text-slate-500">No events yet. Start a batch to see live agent activity.</div>
          )}
        </div>
      </section>
    </div>
  )
}
