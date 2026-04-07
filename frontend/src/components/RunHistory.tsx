import { useState } from 'react'
import clsx from 'clsx'
import { usePipelineStore } from '../store/pipelineStore'
import { MigrationRun } from '../types/pipeline'
import RunDetail from './RunDetail'

const DS_BADGE: Record<string, string> = {
 synthea_standard: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
 clean_cohort: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
 high_anomaly: 'bg-red-500/15 text-red-400 border-red-500/30',
 edge_cases: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
 medicare_sample: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
 medicaid_complex: 'bg-red-500/15 text-red-400 border-red-500/30',
}

function scoreColor(v: number) {
 return v >= 90 ? 'text-emerald-400' : v >= 70 ? 'text-amber-400' : 'text-red-400'
}
function scoreBg(v: number) {
 return v >= 90 ? 'bg-emerald-500' : v >= 70 ? 'bg-amber-500' : 'bg-red-500'
}

function StatusBadge({ status }: { status: string }) {
 const running = status.startsWith('running')
 const label = status === 'complete' ? ' Complete'
 : status === 'failed' ? ' Failed'
 : status.startsWith('running:') ? ` ${status.split(':')[1].replace('_',' ')}`
 : ' Running'
 const style = status === 'complete' ? 'bg-emerald-500/15 text-emerald-400'
 : status === 'failed' ? 'bg-red-500/15 text-red-400'
 : 'bg-blue-500/15 text-blue-400'
 return (
 <span className={clsx('inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-semibold', style)}>
 {running && <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse shrink-0" />}
 {label}
 </span>
 )
}

function RunRow({ run, onClick, isCompareA, isCompareB, onCompare }: {
 run: MigrationRun; onClick: () => void
 isCompareA: boolean; isCompareB: boolean; onCompare: (e: React.MouseEvent) => void
}) {
 const currentRunId = usePipelineStore(s => s.runId)
 const isLive = run.run_id === currentRunId && run.status.startsWith('running')
 const score = run.compliance_score ?? 0
 const isDone = run.status === 'complete'

 return (
 <div
 onClick={onClick}
 className={clsx(
 'flex items-center gap-4 px-5 py-4 rounded-xl border cursor-pointer transition-all group',
 isLive ? 'border-blue-500/40 bg-blue-500/[0.03]' :
 isCompareA || isCompareB ? 'border-violet-500/40 bg-violet-500/[0.03]' :
 'border-slate-800 bg-[#0D1424] hover:border-slate-600 hover:bg-slate-800/30'
 )}
 >
 {/* Dataset name */}
 <div className="w-52 shrink-0">
 <div className="flex items-center gap-2 mb-1">
 <span className={clsx('px-2 py-0.5 rounded border text-xs font-bold', DS_BADGE[run.dataset_id] ?? DS_BADGE.synthea_standard)}>
 {run.dataset_name.split(' ').slice(0, 2).join(' ')}
 </span>
 </div>
 <div className="text-[10px] text-slate-600 font-mono">
 #{run.run_id.slice(-8).toUpperCase()}
 </div>
 </div>

 {/* Status */}
 <div className="w-32 shrink-0">
 <StatusBadge status={run.status} />
 {isLive && <div className="text-[10px] text-blue-400 mt-0.5 animate-pulse"> LIVE</div>}
 </div>

 {/* Records */}
 <div className="w-24 shrink-0 text-center">
 <div className="font-mono font-bold text-white">{run.total_loaded?.toLocaleString() ?? '—'}</div>
 <div className="text-[10px] text-slate-600">records</div>
 </div>

 {/* Compliance score */}
 <div className="w-24 shrink-0 text-center">
 {isDone ? (
 <>
 <div className={clsx('font-mono font-bold text-lg', scoreColor(score))}>{score.toFixed(1)}%</div>
 <div className="text-[10px] text-slate-600">compliance</div>
 </>
 ) : <span className="text-slate-700 text-sm">—</span>}
 </div>

 {/* Mini metric bars */}
 {isDone ? (
 <div className="flex-1 grid grid-cols-4 gap-3">
 {[
 { label: 'ICD-10', val: run.icd10_compliance },
 { label: 'NPI', val: run.npi_validity },
 { label: 'FHIR', val: run.fhir_completeness },
 { label: 'HIPAA', val: run.hipaa_score },
 ].map(m => (
 <div key={m.label}>
 <div className="flex justify-between text-[10px] mb-1">
 <span className="text-slate-600">{m.label}</span>
 <span className={clsx('font-mono', scoreColor(m.val ?? 0))}>{(m.val ?? 0).toFixed(0)}%</span>
 </div>
 <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
 <div className={clsx('h-full rounded-full', scoreBg(m.val ?? 0))} style={{ width: `${m.val ?? 0}%` }} />
 </div>
 </div>
 ))}
 </div>
 ) : (
 <div className="flex-1 text-slate-700 text-sm">—</div>
 )}

 {/* Timestamp + actions */}
 <div className="w-32 shrink-0 text-right">
 <div className="text-xs text-slate-500">{new Date(run.started_at).toLocaleTimeString()}</div>
 <div className="text-[10px] text-slate-700">{new Date(run.started_at).toLocaleDateString()}</div>
 {run.completed_at && (
 <div className="text-[10px] text-slate-700">
 {Math.round((new Date(run.completed_at).getTime() - new Date(run.started_at).getTime())/1000)}s
 </div>
 )}
 </div>

 {/* Compare + detail */}
 <div className="flex items-center gap-2 shrink-0">
 {isDone && (
 <button
 onClick={onCompare}
 className={clsx('px-2.5 py-1 rounded-lg border text-xs font-medium transition-all',
 isCompareA || isCompareB
 ? 'bg-violet-500/15 border-violet-500/40 text-violet-400'
 : 'border-slate-700 text-slate-600 hover:border-slate-500 hover:text-slate-300'
 )}
 >
 {isCompareA ? 'A' : isCompareB ? 'B' : ''}
 </button>
 )}
 <span className="text-slate-600 group-hover:text-slate-400 text-sm transition-colors"></span>
 </div>
 </div>
 )
}

function CompareBar({ runA, runB, onClear }: { runA: MigrationRun; runB: MigrationRun; onClear: () => void }) {
 const metrics: { label: string; a: number | null; b: number | null; higher?: boolean; lower?: boolean }[] = [
 { label: 'Compliance', a: runA.compliance_score, b: runB.compliance_score, higher: true },
 { label: 'Match Rate', a: runA.match_pct, b: runB.match_pct, higher: true },
 { label: 'ICD-10', a: runA.icd10_compliance, b: runB.icd10_compliance, higher: true },
 { label: 'NPI Valid', a: runA.npi_validity, b: runB.npi_validity, higher: true },
 { label: 'FHIR', a: runA.fhir_completeness, b: runB.fhir_completeness, higher: true },
 { label: 'HIPAA', a: runA.hipaa_score, b: runB.hipaa_score, higher: true },
 { label: 'Anomalies', a: runA.anomaly_count, b: runB.anomaly_count, lower: true },
 { label: 'Violations', a: runA.violation_count, b: runB.violation_count, lower: true },
 ]

 return (
 <div className="mb-4 bg-[#0D1424] border border-violet-500/30 rounded-xl overflow-hidden shrink-0">
 <div className="flex items-center justify-between px-5 py-3 border-b border-slate-800 bg-violet-500/5">
 <div className="text-sm font-bold text-white flex items-center gap-2">
 Side-by-Side Comparison
 <span className="text-xs text-violet-400 font-normal">Green = better performer</span>
 </div>
 <button onClick={onClear} className="text-xs text-slate-500 hover:text-slate-300"> Clear</button>
 </div>
 <div className="overflow-x-auto">
 <table className="w-full text-sm">
 <thead>
 <tr className="border-b border-slate-800 text-xs">
 <th className="text-left px-5 py-2.5 text-slate-500 font-semibold">Metric</th>
 <th className="text-center px-5 py-2.5 text-violet-400 font-semibold">
 A — {runA.dataset_name.split(' ')[0]}
 </th>
 <th className="text-center px-5 py-2.5 text-violet-300 font-semibold">
 B — {runB.dataset_name.split(' ')[0]}
 </th>
 <th className="text-center px-5 py-2.5 text-slate-500 font-semibold">Δ (A−B)</th>
 </tr>
 </thead>
 <tbody>
 {metrics.map(m => {
 const aBetter = m.a != null && m.b != null &&
 (m.higher ? m.a > m.b : m.lower ? m.a < m.b : false)
 const bBetter = m.a != null && m.b != null &&
 (m.higher ? m.b > m.a : m.lower ? m.b < m.a : false)
 const diff = m.a != null && m.b != null ? (m.a - m.b).toFixed(1) : '—'
 return (
 <tr key={m.label} className="border-b border-slate-800/40 last:border-0 hover:bg-slate-800/20">
 <td className="px-5 py-2.5 text-slate-400 font-semibold text-xs">{m.label}</td>
 <td className={clsx('px-5 py-2.5 text-center font-mono font-bold text-sm',
 aBetter ? 'text-emerald-400' : 'text-slate-300')}>
 {m.a != null ? (Number.isInteger(m.a) ? m.a.toLocaleString() : m.a.toFixed(1) + '%') : '—'}
 </td>
 <td className={clsx('px-5 py-2.5 text-center font-mono font-bold text-sm',
 bBetter ? 'text-emerald-400' : 'text-slate-300')}>
 {m.b != null ? (Number.isInteger(m.b) ? m.b.toLocaleString() : m.b.toFixed(1) + '%') : '—'}
 </td>
 <td className={clsx('px-5 py-2.5 text-center font-mono text-xs',
 diff !== '—' && parseFloat(diff) > 0 ? 'text-emerald-400' :
 diff !== '—' && parseFloat(diff) < 0 ? 'text-red-400' : 'text-slate-600')}>
 {diff !== '—' ? (parseFloat(diff) > 0 ? '+' : '') + diff : '—'}
 </td>
 </tr>
 )
 })}
 </tbody>
 </table>
 </div>
 </div>
 )
}

export default function RunHistory() {
 const runs = usePipelineStore(s => s.runs)
 const [selected, setSelected] = useState<MigrationRun | null>(null)
 const [compareA, setCompareA] = useState<string | null>(null)
 const [compareB, setCompareB] = useState<string | null>(null)

 const handleCompare = (e: React.MouseEvent, id: string) => {
 e.stopPropagation()
 if (compareA === id) { setCompareA(compareB); setCompareB(null); return }
 if (compareB === id) { setCompareB(null); return }
 if (!compareA) { setCompareA(id); return }
 if (!compareB) { setCompareB(id); return }
 setCompareA(id); setCompareB(null)
 }

 if (selected) return <RunDetail run={selected} onBack={() => setSelected(null)} />

 if (runs.length === 0) return (
 <div className="flex flex-col items-center justify-center h-full gap-3 text-slate-600">
 <div className="text-5xl opacity-20"></div>
 <div className="text-base">No migration runs yet</div>
 <div className="text-sm">Start a migration to see history here</div>
 </div>
 )

 const runA = runs.find(r => r.run_id === compareA)
 const runB = runs.find(r => r.run_id === compareB)

 return (
 <div className="flex flex-col h-full overflow-hidden">
 {compareA && compareB && runA && runB && (
 <CompareBar runA={runA} runB={runB} onClear={() => { setCompareA(null); setCompareB(null) }} />
 )}

 {/* Table header */}
 <div className="flex items-center gap-4 px-5 py-2 text-xs text-slate-600 font-semibold uppercase tracking-wider border-b border-slate-800 shrink-0">
 <div className="w-52 shrink-0">Dataset</div>
 <div className="w-32 shrink-0">Status</div>
 <div className="w-24 shrink-0 text-center">Records</div>
 <div className="w-24 shrink-0 text-center">Compliance</div>
 <div className="flex-1">ICD-10 · NPI · FHIR · HIPAA</div>
 <div className="w-32 shrink-0 text-right">Time</div>
 <div className="w-16 shrink-0">
 {(compareA || compareB) && (
 <button onClick={() => { setCompareA(null); setCompareB(null) }} className="text-slate-500 hover:text-slate-300 text-xs"></button>
 )}
 </div>
 </div>

 {compareA && !compareB && (
 <div className="px-5 py-2 bg-violet-500/5 border-b border-violet-500/20 text-xs text-violet-400 shrink-0">
 Run A selected — click on another completed run to compare
 </div>
 )}

 {/* Run list */}
 <div className="flex-1 overflow-y-auto space-y-1.5 py-2 min-h-0">
 {runs.map(run => (
 <RunRow
 key={run.run_id}
 run={run}
 onClick={() => setSelected(run)}
 isCompareA={compareA === run.run_id}
 isCompareB={compareB === run.run_id}
 onCompare={(e) => handleCompare(e, run.run_id)}
 />
 ))}
 </div>
 </div>
 )
}
