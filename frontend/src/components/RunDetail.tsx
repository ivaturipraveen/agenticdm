import { useEffect, useState } from 'react'
import clsx from 'clsx'
import { MigrationRun } from '../types/pipeline'
import DataView from './DataView'

interface RunLog { timestamp: string; agent: string; action: string; status: string; records_affected: number; details: string; log_type: string }
interface AgentOutput { agent: string; agent_num: number; status: string; records_in: number; records_out: number; anomalies: number; summary: string; output: Record<string, unknown>; completed_at: string }

const AGENT_META: Record<string, { num: number; title: string; input: string; output: string }> = {
  discovery:       { num: 1, title: 'Discovery Agent',          input: 'Source tables, columns, data types, sample rows',     output: 'Mapping contract — FHIR field assignments with confidence' },
  transformation:  { num: 2, title: 'Transformation Agent',     input: 'Mapping contract + source rows',                       output: 'FHIR-ready resources, anomalies quarantined, validation results' },
  orchestration:   { num: 3, title: 'Orchestration Agent',      input: 'Validated FHIR resources + operator approval',         output: 'Resources loaded to FHIR endpoint, counts confirmed' },
  qa:              { num: 4, title: 'QA / Reconciliation Agent', input: 'Source record counts + loaded FHIR resource counts',   output: 'Match rate, integrity checksums, compliance score' },
  monitor:         { num: 5, title: 'Integration Monitor',       input: 'Source schema snapshot',                               output: 'Schema stability confirmed or drift alert raised' },
}

function AgentStepCard({ output, isActive, onClick }: { output: AgentOutput; isActive: boolean; onClick: () => void }) {
  const meta = AGENT_META[output.agent] || { num: 0, title: output.agent, input: '', output: '' }
  const ok = output.status === 'success'
  return (
    <button onClick={onClick} className={clsx('w-full text-left p-4 rounded-2xl border transition-all', isActive ? 'border-blue-300 bg-blue-50 shadow-sm' : 'border-slate-200 bg-white hover:border-slate-300')}>
      <div className="flex items-center gap-3">
        <div className={clsx('w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold shrink-0', ok ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600')}>{meta.num}</div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-slate-900">{meta.title}</div>
          <div className="text-xs text-slate-500 mt-0.5">{(output.records_in ?? 0).toLocaleString()} in → {(output.records_out ?? 0).toLocaleString()} out</div>
        </div>
        <span className={clsx('px-2 py-0.5 rounded-full text-[10px] font-bold', ok ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700')}>{ok ? 'Done' : 'Partial'}</span>
      </div>
    </button>
  )
}

function DiscoveryDetail({ output }: { output: AgentOutput }) {
  const mapping = (output.output as any)?.mapping_summary || []
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Tables Scanned', v: mapping.length || 0, color: 'text-slate-900' },
          { label: 'Auto-mapped Fields', v: (output.output as any)?.summary?.auto_mapped_fields ?? (output.records_out ?? 0), color: 'text-emerald-700' },
          { label: 'Needs Review', v: (output.output as any)?.summary?.requires_review_fields ?? 0, color: 'text-amber-700' },
        ].map(m => (
          <div key={m.label} className="rounded-2xl border border-slate-200 bg-white p-4 text-center shadow-sm">
            <div className={clsx('text-3xl font-bold font-mono', m.color)}>{m.v}</div>
            <div className="text-xs text-slate-500 mt-1">{m.label}</div>
          </div>
        ))}
      </div>
      {mapping.length > 0 && mapping.map((t: any) => (
        <div key={t.table} className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm">
          <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
            <div><span className="font-semibold text-slate-900">{t.table}</span><span className="mx-2 text-slate-400">→</span><span className="font-semibold text-blue-700">{t.resource}</span><span className="ml-2 text-xs text-slate-500">• {t.row_count?.toLocaleString()} rows</span></div>
            <span className="text-xs text-emerald-700 font-semibold">{Math.round((t.resource_confidence ?? 0) * 100)}% confidence</span>
          </div>
          <table className="w-full text-xs">
            <thead><tr className="bg-slate-50 border-b border-slate-100"><th className="text-left px-4 py-2.5 text-slate-500 font-semibold w-[35%]">Source Column</th><th className="text-left px-4 py-2.5 text-slate-500 font-semibold w-[40%]">FHIR Field</th><th className="text-left px-4 py-2.5 text-slate-500 font-semibold w-[15%]">Confidence</th><th className="text-left px-4 py-2.5 text-slate-500 font-semibold">Status</th></tr></thead>
            <tbody>{(t.fields || []).map((f: any) => (
              <tr key={f.source_column} className="border-b border-slate-100 last:border-0">
                <td className="px-4 py-2.5 font-mono text-slate-700">{f.source_column}</td>
                <td className="px-4 py-2.5 font-mono text-blue-700 truncate max-w-[200px]">{f.target_field || '—'}</td>
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <div className="w-16 h-1.5 bg-slate-100 rounded-full overflow-hidden"><div className={clsx('h-full rounded-full', f.confidence >= 0.85 ? 'bg-emerald-500' : f.confidence >= 0.55 ? 'bg-amber-400' : 'bg-slate-300')} style={{ width: `${Math.round((f.confidence ?? 0) * 100)}%` }} /></div>
                    <span className="text-slate-600 font-mono text-[10px]">{Math.round((f.confidence ?? 0) * 100)}%</span>
                  </div>
                </td>
                <td className="px-4 py-2.5"><span className={clsx('px-2 py-0.5 rounded-full text-[10px] font-semibold', f.status === 'auto_mapped' ? 'bg-emerald-100 text-emerald-700' : f.status === 'requires_review' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500')}>{f.status === 'auto_mapped' ? 'Auto' : f.status === 'requires_review' ? 'Review' : 'Skip'}</span></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ))}
    </div>
  )
}

function TransformationDetail({ output }: { output: AgentOutput }) {
  const ts = (output.output as any)?.transformation_summary || {}
  const samples = (output.output as any)?.fhir_samples || []
  const errors = (output.output as any)?.validation_errors || []
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: 'Source Rows', v: ts.total_records ?? output.records_in, color: 'text-slate-900' },
          { label: 'Converted', v: ts.converted ?? output.records_out, color: 'text-blue-700' },
          { label: 'For Review', v: ts.requires_review ?? 0, color: 'text-amber-700' },
          { label: 'Failed', v: ts.failed ?? output.anomalies, color: errors.length > 0 ? 'text-red-700' : 'text-slate-500' },
        ].map(m => (
          <div key={m.label} className="rounded-2xl border border-slate-200 bg-white p-4 text-center shadow-sm">
            <div className={clsx('text-3xl font-bold font-mono', m.color)}>{m.v}</div>
            <div className="text-xs text-slate-500 mt-1">{m.label}</div>
          </div>
        ))}
      </div>
      {errors.length > 0 && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 shadow-sm">
          <div className="text-sm font-bold text-red-800 mb-2">{errors.length} validation failure{errors.length > 1 ? 's' : ''}</div>
          {errors.slice(0, 3).map((e: any, i: number) => <div key={i} className="text-xs text-red-700 mt-1">{e.table} row {e.record_index + 1}: {(e.errors || []).join(', ')}</div>)}
        </div>
      )}
      {samples.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm">
          <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 text-sm font-bold text-slate-900">Sample FHIR Output</div>
          <pre className="p-4 text-xs text-slate-700 overflow-x-auto whitespace-pre-wrap">{JSON.stringify(samples[0], null, 2)}</pre>
        </div>
      )}
    </div>
  )
}

function OrchestrationDetail({ output }: { output: AgentOutput }) {
  const resources = (output.output as any)?.resources || {}
  const fhirUrl = (output.output as any)?.fhir_url || 'Configured endpoint'
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-cyan-200 bg-cyan-50 p-4 shadow-sm">
        <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">FHIR Target Endpoint</div>
        <div className="font-mono text-cyan-800 text-sm">{fhirUrl}</div>
      </div>
      <div className="grid grid-cols-3 gap-4">
        {Object.entries(resources).map(([type, count]) => (
          <div key={type} className="rounded-2xl border border-slate-200 bg-white p-4 text-center shadow-sm">
            <div className="text-3xl font-bold font-mono text-cyan-700">{count as number}</div>
            <div className="text-xs text-slate-500 mt-1">{type} resources loaded</div>
          </div>
        ))}
      </div>
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 shadow-sm">
        <div className="text-sm font-semibold text-emerald-800">Load complete</div>
        <div className="text-xs text-emerald-700 mt-1">{output.records_out.toLocaleString()} resources were sent to the FHIR endpoint and stored locally.</div>
      </div>
    </div>
  )
}

function QADetail({ output }: { output: AgentOutput }) {
  const r = output.output as any
  const match = r.match_pct ?? 0
  const checks = [
    { label: 'member_id integrity', ok: r.checksum_member_id },
    { label: 'claim_amount integrity', ok: r.checksum_claim_amount },
    { label: 'date_of_service integrity', ok: r.checksum_date_of_service },
  ]
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm">
        <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 text-sm font-bold text-slate-900">Source vs FHIR Output</div>
        <div className="grid grid-cols-3 divide-x divide-slate-200">
          <div className="p-5 text-center"><div className="text-xs text-slate-500 mb-2 uppercase tracking-wider">Source</div><div className="text-4xl font-bold font-mono text-slate-900">{(r.source_count ?? 0).toLocaleString()}</div></div>
          <div className="p-5 text-center"><div className="text-xs text-slate-500 mb-2 uppercase tracking-wider">FHIR Output</div><div className="text-4xl font-bold font-mono text-blue-700">{(r.target_count ?? 0).toLocaleString()}</div></div>
          <div className="p-5 text-center"><div className="text-xs text-slate-500 mb-2 uppercase tracking-wider">Match Rate</div><div className={clsx('text-4xl font-bold font-mono', match >= 99 ? 'text-emerald-700' : 'text-amber-700')}>{match}%</div></div>
        </div>
      </div>
      <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm">
        <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 text-sm font-bold text-slate-900">Integrity Checks</div>
        {checks.map(c => (
          <div key={c.label} className="flex items-center justify-between px-4 py-3.5 border-b border-slate-100 last:border-0">
            <span className="text-sm text-slate-700">{c.label}</span>
            <span className={clsx('px-3 py-1 rounded-xl text-xs font-bold', c.ok ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700')}>{c.ok ? 'PASS' : 'FAIL'}</span>
          </div>
        ))}
      </div>
      {(r.anomalies_quarantined ?? 0) > 0 && <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 shadow-sm"><div className="text-sm font-semibold text-amber-800">{r.anomalies_quarantined} records quarantined</div><div className="text-xs text-amber-700 mt-1">These records had quality issues and were not loaded to FHIR.</div></div>}
    </div>
  )
}

function MonitorDetail({ output }: { output: AgentOutput }) {
  const watched = (output.output as any)?.tables_watched || ['members', 'eligibility', 'claims']
  const drift = (output.output as any)?.drift_detected
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm">
        <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 text-sm font-bold text-slate-900">Schema Watch Results</div>
        {watched.map((t: string) => (
          <div key={t} className="flex items-center justify-between px-4 py-3.5 border-b border-slate-100 last:border-0">
            <div><div className="text-sm font-medium text-slate-900 capitalize">{t}</div><div className="text-xs text-slate-500">Checked every 30 seconds</div></div>
            <span className={clsx('px-3 py-1 rounded-xl text-xs font-bold', drift ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700')}>{drift ? 'DRIFT' : 'Stable'}</span>
          </div>
        ))}
      </div>
      <div className={clsx('rounded-2xl border p-4 shadow-sm', drift ? 'border-red-200 bg-red-50' : 'border-emerald-200 bg-emerald-50')}>
        <div className={clsx('text-sm font-semibold', drift ? 'text-red-800' : 'text-emerald-800')}>{drift ? 'Schema drift was detected' : 'No schema drift detected'}</div>
        <div className={clsx('text-xs mt-1', drift ? 'text-red-700' : 'text-emerald-700')}>{drift ? 'The pipeline was halted to prevent data integrity issues.' : 'Source tables maintained their structure throughout the entire run.'}</div>
      </div>
    </div>
  )
}

function StepDetail({ output, agent }: { output: AgentOutput; agent: string }) {
  const meta = AGENT_META[agent] || AGENT_META.discovery
  switch (agent) {
    case 'discovery':      return <DiscoveryDetail output={output} />
    case 'transformation': return <TransformationDetail output={output} />
    case 'orchestration':  return <OrchestrationDetail output={output} />
    case 'qa':             return <QADetail output={output} />
    case 'monitor':        return <MonitorDetail output={output} />
    default:               return <div className="text-slate-500 p-4">No detail view available.</div>
  }
}

export default function RunDetail({ run, onBack }: { run: MigrationRun; onBack: () => void }) {
  const [agentOutputs, setAgentOutputs] = useState<AgentOutput[]>([])
  const [active, setActive] = useState<string>('discovery')
  const [view, setView] = useState<'steps' | 'final'>('steps')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/runs/${run.run_id}/agents`).then(r => r.json()).then(a => {
      setAgentOutputs(Array.isArray(a) ? a : [])
      setLoading(false)
    })
  }, [run.run_id])

  const activeOutput = agentOutputs.find(a => a.agent === active)

  const STATUS_COLOR: Record<string, string> = { complete: 'bg-emerald-100 text-emerald-700', failed: 'bg-red-100 text-red-700', running: 'bg-blue-100 text-blue-700' }
  const statusLabel = run.status === 'complete' ? 'Complete' : run.status === 'failed' ? 'Failed' : run.status

  return (
    <div className="flex flex-col h-full bg-slate-50">
      {/* Top bar */}
      <div className="flex items-center gap-4 px-5 py-4 border-b border-slate-200 shrink-0 bg-white shadow-sm">
        <button onClick={onBack} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-300 text-slate-600 hover:bg-slate-100 text-sm transition-all bg-white">
          ← Back
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <span className="text-slate-900 font-bold text-lg">{run.dataset_name}</span>
            <span className={clsx('px-2.5 py-1 rounded-full text-xs font-semibold', STATUS_COLOR[run.status] || 'bg-slate-100 text-slate-600')}>{statusLabel}</span>
          </div>
          <div className="text-slate-400 text-xs font-mono mt-0.5">Run #{run.run_id.slice(-8).toUpperCase()} · {new Date(run.started_at).toLocaleString()}</div>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <div className="text-right"><div className="text-slate-900 font-bold font-mono">{(run.total_source ?? 0).toLocaleString()}</div><div className="text-slate-400 text-xs">source</div></div>
          <div className="text-slate-300">→</div>
          <div className="text-right"><div className="text-blue-700 font-bold font-mono">{(run.total_loaded ?? 0).toLocaleString()}</div><div className="text-slate-400 text-xs">FHIR</div></div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
            <div className="text-emerald-700 font-bold font-mono">{run.match_pct?.toFixed(1) ?? '—'}%</div>
            <div className="text-slate-400 text-xs">match</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setView('steps')} className={clsx('px-3 py-1.5 rounded-xl text-sm border', view === 'steps' ? 'border-blue-300 bg-blue-50 text-blue-700 font-semibold' : 'border-slate-300 text-slate-600 bg-white')}>Steps</button>
          <button onClick={() => setView('final')} className={clsx('px-3 py-1.5 rounded-xl text-sm border', view === 'final' ? 'border-blue-300 bg-blue-50 text-blue-700 font-semibold' : 'border-slate-300 text-slate-600 bg-white')}>Final Results</button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center flex-1 text-slate-400 gap-2">
          <div className="w-5 h-5 border-2 border-slate-300 border-t-blue-500 rounded-full animate-spin" />Loading run data…
        </div>
      ) : view === 'final' ? (
        <DataView runId={run.run_id} datasetName={run.dataset_name} />
      ) : (
        <div className="flex flex-1 min-h-0">
          {/* Sidebar: agent steps */}
          <div className="w-72 shrink-0 border-r border-slate-200 bg-white p-4 overflow-y-auto space-y-2">
            <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold mb-3 px-1">Pipeline Steps</div>
            {agentOutputs.map(a => <AgentStepCard key={a.agent} output={a} isActive={active === a.agent} onClick={() => setActive(a.agent)} />)}
          </div>

          {/* Main: step detail */}
          <div className="flex-1 min-w-0 overflow-y-auto p-5 space-y-5">
            {activeOutput ? (
              <>
                <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-3 mb-2">
                        <div className="w-9 h-9 rounded-full bg-blue-100 text-blue-700 font-bold text-sm flex items-center justify-center">{AGENT_META[active]?.num || '?'}</div>
                        <div className="text-xl font-bold text-slate-900">{AGENT_META[active]?.title || active}</div>
                      </div>
                    </div>
                    <div className="flex gap-4 text-center text-sm">
                      <div><div className="font-bold font-mono text-slate-900">{(activeOutput.records_in ?? 0).toLocaleString()}</div><div className="text-xs text-slate-400">input</div></div>
                      <div className="text-slate-300 self-center">→</div>
                      <div><div className="font-bold font-mono text-blue-700">{(activeOutput.records_out ?? 0).toLocaleString()}</div><div className="text-xs text-slate-400">output</div></div>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3 mt-4">
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3"><div className="text-[10px] uppercase font-semibold text-slate-400 mb-1">Input to this step</div><div className="text-sm text-slate-700">{AGENT_META[active]?.input}</div></div>
                    <div className="rounded-xl border border-blue-100 bg-blue-50 p-3"><div className="text-[10px] uppercase font-semibold text-blue-400 mb-1">Output from this step</div><div className="text-sm text-slate-700">{AGENT_META[active]?.output}</div></div>
                  </div>
                </div>
                <StepDetail output={activeOutput} agent={active} />
              </>
            ) : (
              <div className="text-slate-400 p-8">Select a step from the left to see details.</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
