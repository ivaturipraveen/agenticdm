import clsx from 'clsx'
import { usePipelineStore } from '../store/pipelineStore'
import { ComplianceReport, ComplianceRule } from '../types/pipeline'

function ScoreRing({ score, size = 'md' }: { score: number; size?: 'sm' | 'md' | 'lg' }) {
 const radius = size === 'lg' ? 42 : size === 'md' ? 32 : 22
 const stroke = size === 'lg' ? 6 : 4
 const circ = 2 * Math.PI * radius
 const dash = (score / 100) * circ
 const color = score >= 90 ? '#10B981' : score >= 70 ? '#F59E0B' : '#EF4444'
 const sz = (radius + stroke) * 2

 return (
 <svg width={sz} height={sz} className="-rotate-90">
 <circle cx={radius + stroke} cy={radius + stroke} r={radius} fill="none" stroke="#1E293B" strokeWidth={stroke} />
 <circle cx={radius + stroke} cy={radius + stroke} r={radius} fill="none" stroke={color}
 strokeWidth={stroke} strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
 style={{ transition: 'stroke-dasharray 1s ease' }} />
 </svg>
 )
}

function RuleRow({ rule }: { rule: ComplianceRule }) {
 const pct = rule.score
 const pass = pct >= rule.threshold
 const warn = pct >= 80 && pct < rule.threshold
 return (
 <div className="flex items-center gap-3 py-2.5 border-b border-slate-800/60 last:border-0">
 <div className={clsx('w-2 h-2 rounded-full shrink-0', pass ? 'bg-emerald-400' : warn ? 'bg-amber-400' : 'bg-red-400')} />
 <div className="flex-1 min-w-0">
 <div className="flex items-center gap-2">
 <span className="text-sm text-slate-200 font-medium">{rule.name}</span>
 <span className="text-[10px] text-slate-600 font-mono hidden sm:block">{rule.standard}</span>
 </div>
 <div className="flex items-center gap-2 mt-1">
 <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden">
 <div
 className={clsx('h-full rounded-full transition-all duration-700', pass ? 'bg-emerald-500' : warn ? 'bg-amber-500' : 'bg-red-500')}
 style={{ width: `${pct}%` }}
 />
 </div>
 <span className={clsx('text-xs font-mono font-bold w-12 text-right shrink-0', pass ? 'text-emerald-400' : warn ? 'text-amber-400' : 'text-red-400')}>
 {pct.toFixed(1)}%
 </span>
 </div>
 </div>
 <div className="text-right shrink-0">
 <div className="text-xs text-slate-500">{rule.passed}/{rule.total}</div>
 <div className="text-[10px] text-slate-700">threshold: {rule.threshold}%</div>
 </div>
 <span className={clsx('px-1.5 py-0.5 rounded text-[10px] font-bold shrink-0',
 pass ? 'bg-emerald-500/15 text-emerald-400' : warn ? 'bg-amber-500/15 text-amber-400' : 'bg-red-500/15 text-red-400'
 )}>
 {pass ? 'PASS' : 'FAIL'}
 </span>
 </div>
 )
}

function ScoreCard({ label, score, icon }: { label: string; score: number; icon: string }) {
 const color = score >= 90 ? 'text-emerald-400' : score >= 70 ? 'text-amber-400' : 'text-red-400'
 return (
 <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4 flex flex-col items-center gap-2">
 <div className="relative flex items-center justify-center">
 <ScoreRing score={score} size="md" />
 <div className="absolute inset-0 flex items-center justify-center">
 <span className={clsx('text-xs font-bold font-mono', color)}>{score.toFixed(0)}%</span>
 </div>
 </div>
 <div className="text-center">
 <div className="text-sm">{icon}</div>
 <div className="text-[11px] text-slate-400 font-medium mt-0.5 text-center leading-tight">{label}</div>
 </div>
 </div>
 )
}

export default function ComplianceDashboard({ report }: { report: ComplianceReport }) {
 const overallColor = report.overall_score >= 90 ? 'text-emerald-400' : report.overall_score >= 70 ? 'text-amber-400' : 'text-red-400'
 const overallLabel = report.overall_score >= 90 ? 'Compliant' : report.overall_score >= 70 ? 'Needs Review' : 'Non-Compliant'
 const overallBg = report.overall_score >= 90 ? 'bg-emerald-500/10 border-emerald-500/30' : report.overall_score >= 70 ? 'bg-amber-500/10 border-amber-500/30' : 'bg-red-500/10 border-red-500/30'

 return (
 <div className="space-y-5">
 {/* Overall score hero */}
 <div className={clsx('flex items-center gap-6 p-5 rounded-xl border', overallBg)}>
 <div className="relative flex items-center justify-center shrink-0">
 <ScoreRing score={report.overall_score} size="lg" />
 <div className="absolute inset-0 flex flex-col items-center justify-center">
 <span className={clsx('text-xl font-black font-mono', overallColor)}>{report.overall_score.toFixed(1)}%</span>
 </div>
 </div>
 <div>
 <div className={clsx('text-2xl font-bold', overallColor)}>{overallLabel}</div>
 <div className="text-slate-400 text-sm mt-0.5">Overall Compliance Score</div>
 <div className="flex items-center gap-3 mt-2 text-xs">
 <span className="text-emerald-400 font-semibold">
 {report.summary.passed_rules}/{report.summary.total_rules} rules passed
 </span>
 {report.summary.critical_failures.length > 0 && (
 <span className="text-red-400"> Critical: {report.summary.critical_failures.join(', ')}</span>
 )}
 </div>
 </div>
 </div>

 {/* Score grid */}
 <div className="grid grid-cols-4 gap-3">
 <ScoreCard label="ICD-10 Format" score={report.icd10_compliance} icon="" />
 <ScoreCard label="NPI Validity" score={report.npi_validity} icon="" />
 <ScoreCard label="FHIR Complete" score={report.fhir_completeness} icon="" />
 <ScoreCard label="HIPAA PHI" score={report.hipaa_score} icon="" />
 </div>

 {/* Rules breakdown */}
 <div className="bg-[#0D1424] border border-slate-800 rounded-xl overflow-hidden">
 <div className="px-4 py-3 border-b border-slate-800 bg-slate-900/40">
 <div className="text-sm font-bold text-white">Regulatory Rules Check</div>
 <div className="text-xs text-slate-500 mt-0.5">HIPAA · FHIR R4 · CMS · HL7</div>
 </div>
 <div className="px-4">
 {report.rules.map(r => <RuleRow key={r.id} rule={r} />)}
 </div>
 </div>
 </div>
 )
}
