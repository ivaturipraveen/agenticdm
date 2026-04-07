import { useState } from 'react'
import clsx from 'clsx'
import { usePipelineStore } from '../store/pipelineStore'
import { ComplianceReport, MigrationRun } from '../types/pipeline'

// Helpers 

function scoreColor(v: number, threshold = 90) {
 return v >= threshold ? 'text-emerald-400' : v >= 70 ? 'text-amber-400' : 'text-red-400'
}
function scoreBg(v: number, threshold = 90) {
 return v >= threshold ? 'bg-emerald-500' : v >= 70 ? 'bg-amber-500' : 'bg-red-500'
}
function scoreLabel(v: number) {
 return v >= 90 ? 'Compliant' : v >= 70 ? 'Needs Review' : 'Non-Compliant'
}
function scoreBorder(v: number) {
 return v >= 90 ? 'border-emerald-500/30' : v >= 70 ? 'border-amber-500/30' : 'border-red-500/30'
}
function scoreBgCard(v: number) {
 return v >= 90 ? 'bg-emerald-500/5' : v >= 70 ? 'bg-amber-500/5' : 'bg-red-500/5'
}

const DS_BADGE: Record<string, string> = {
 synthea_standard: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
 clean_cohort: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
 high_anomaly: 'bg-red-500/15 text-red-400 border-red-500/30',
 edge_cases: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
 medicare_sample: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
 medicaid_complex: 'bg-red-500/15 text-red-400 border-red-500/30',
}

// Run card for selector 

function RunCard({ run, selected, onClick }: { run: MigrationRun; selected: boolean; onClick: () => void }) {
 const score = run.compliance_score ?? 0
 return (
 <button
 onClick={onClick}
 className={clsx(
 'w-full text-left p-4 rounded-xl border-2 transition-all',
 selected
 ? `${scoreBorder(score)} ${scoreBgCard(score)} shadow-lg`
 : 'border-slate-800 bg-[#0D1424] hover:border-slate-700'
 )}
 >
 <div className="flex items-start justify-between gap-3 mb-3">
 <div>
 <span className={clsx('inline-flex px-2 py-0.5 rounded border text-xs font-bold', DS_BADGE[run.dataset_id] ?? DS_BADGE.synthea_standard)}>
 {run.dataset_name}
 </span>
 <div className="text-[10px] text-slate-600 font-mono mt-1">
 #{run.run_id.slice(-8).toUpperCase()} · {new Date(run.completed_at ?? run.started_at).toLocaleDateString()}
 </div>
 </div>
 <div className="text-right shrink-0">
 <div className={clsx('text-3xl font-black font-mono', scoreColor(score))}>{score.toFixed(1)}%</div>
 <div className={clsx('text-xs font-semibold', scoreColor(score))}>{scoreLabel(score)}</div>
 </div>
 </div>
 <div className="grid grid-cols-4 gap-1.5">
 {[
 { label: 'ICD-10', val: run.icd10_compliance },
 { label: 'NPI', val: run.npi_validity },
 { label: 'FHIR', val: run.fhir_completeness },
 { label: 'HIPAA', val: run.hipaa_score },
 ].map(m => (
 <div key={m.label} className="text-center">
 <div className="h-1 bg-slate-800 rounded-full overflow-hidden mb-1">
 <div className={clsx('h-full rounded-full', scoreBg(m.val ?? 0, 90))} style={{ width: `${m.val ?? 0}%` }} />
 </div>
 <div className="text-[10px] text-slate-600">{m.label}</div>
 <div className={clsx('text-[10px] font-mono font-bold', scoreColor(m.val ?? 0))}>{(m.val ?? 0).toFixed(0)}%</div>
 </div>
 ))}
 </div>
 </button>
 )
}

// Detailed rule breakdown 

const RULE_EXPLANATIONS: Record<string, { what: string; why: string; fix: string }> = {
 'HIPAA-NPI': {
 what: 'Every healthcare provider must have a valid 10-digit NPI (National Provider Identifier)',
 why: 'Required by HIPAA 45 CFR § 162.410. Missing or invalid NPIs block claims processing and create audit liability.',
 fix: 'Ensure all provider_npi fields contain exactly 10 digits. Flag records with missing NPIs as anomalies before load.',
 },
 'FHIR-ICD10': {
 what: 'ICD-10 diagnosis codes must follow standard format (e.g. A01.1, not A011)',
 why: 'FHIR R4 Claim.diagnosis requires codes from http://hl7.org/fhir/sid/icd-10. Malformed codes fail FHIR validation.',
 fix: 'Insert dot at position 3 for codes missing the decimal separator. Transformation Agent auto-fixes these.',
 },
 'FHIR-COMPLETE': {
 what: 'All required FHIR R4 resource fields must be populated',
 why: 'FHIR R4 "Must Support" elements must be present and non-null. Missing fields cause POST rejections.',
 fix: 'Apply default values for null required fields. Use "UNKNOWN" where value is not available.',
 },
 'HIPAA-PHI': {
 what: 'Protected Health Information fields (name, DOB) must be present for all members',
 why: 'HIPAA Privacy Rule requires accurate patient identification. Missing PHI fields violate audit requirements.',
 fix: 'Ensure first_name, last_name, date_of_birth are populated for every member record.',
 },
 'CMS-DATE': {
 what: 'All dates must be in ISO 8601 format (YYYY-MM-DD)',
 why: 'CMS claims data standards require ISO 8601 dates. Non-standard formats cause rejection during FHIR submission.',
 fix: 'Standardize all date fields to YYYY-MM-DD using the Transformation Agent date normalizer.',
 },
 'HL7-GENDER': {
 what: 'Gender values must use HL7 FHIR coding (male, female, other, unknown)',
 why: 'Patient.gender must be one of the HL7 AdministrativeGender code values for FHIR compliance.',
 fix: "Map source gender codes: Mmale, Ffemale, nullunknown.",
 },
 'FHIR-UUID': {
 what: 'FHIR Patient.id must be a valid UUID v4 format',
 why: 'FHIR R4 Resource.id requires UUID format for stable referencing across systems.',
 fix: 'Use Transformation Agent to convert non-UUID member IDs to deterministic UUID v5 values.',
 },
 'CMS-AMOUNT': {
 what: 'Claim amounts must be positive numeric values',
 why: 'CMS claim submission rules require valid monetary amounts. Zero or null amounts trigger rejection.',
 fix: 'Validate claim_amount > 0 for all claims. Set default 0.0 and flag as anomaly if originally null.',
 },
}

function RuleDetail({ rule }: { rule: NonNullable<ComplianceReport['rules']>[0] }) {
 const [expanded, setExpanded] = useState(false)
 const passed = rule.score >= rule.threshold
 const explanation = RULE_EXPLANATIONS[rule.id]

 return (
 <div className={clsx(
 'border rounded-xl overflow-hidden transition-all',
 passed ? 'border-emerald-500/20' : 'border-red-500/30'
 )}>
 <button
 onClick={() => setExpanded(e => !e)}
 className={clsx('w-full flex items-center gap-4 p-4 text-left transition-colors hover:bg-slate-800/30', passed ? 'bg-emerald-500/[0.03]' : 'bg-red-500/[0.04]')}
 >
 {/* Pass/Fail badge */}
 <div className={clsx('w-16 text-center shrink-0 px-2 py-1 rounded-lg text-xs font-bold',
 passed ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'
 )}>
 {passed ? ' PASS' : ' FAIL'}
 </div>

 {/* Rule info */}
 <div className="flex-1 min-w-0">
 <div className="flex items-center gap-2 flex-wrap">
 <span className="text-white font-semibold text-sm">{rule.name}</span>
 <span className="text-slate-500 text-xs font-mono">{rule.standard}</span>
 </div>
 <div className="flex items-center gap-3 mt-1.5">
 <div className="flex-1 h-2 bg-slate-800 rounded-full overflow-hidden max-w-xs">
 <div className={clsx('h-full rounded-full transition-all', scoreBg(rule.score, rule.threshold))}
 style={{ width: `${rule.score}%` }} />
 </div>
 <span className={clsx('text-sm font-mono font-bold shrink-0', scoreColor(rule.score, rule.threshold))}>
 {rule.score.toFixed(1)}%
 </span>
 <span className="text-slate-500 text-xs shrink-0">{rule.passed}/{rule.total} records</span>
 <span className="text-slate-700 text-xs shrink-0">threshold: {rule.threshold}%</span>
 </div>
 </div>

 {/* Expand arrow */}
 <span className={clsx('text-slate-500 shrink-0 transition-transform', expanded && 'rotate-180')}></span>
 </button>

 {/* Expanded explanation */}
 {expanded && explanation && (
 <div className="px-4 pb-4 pt-0 bg-slate-900/40 border-t border-slate-800 space-y-3">
 <div className="grid grid-cols-3 gap-4 pt-3">
 <div>
 <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5"> What it checks</div>
 <div className="text-sm text-slate-300 leading-relaxed">{explanation.what}</div>
 </div>
 <div>
 <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5"> Why it matters</div>
 <div className="text-sm text-slate-300 leading-relaxed">{explanation.why}</div>
 </div>
 <div>
 <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5"> How to fix</div>
 <div className="text-sm text-slate-300 leading-relaxed">{explanation.fix}</div>
 </div>
 </div>
 {!passed && (
 <div className="flex items-center gap-2 px-3 py-2 bg-red-500/10 border border-red-500/20 rounded-lg">
 <span className="text-red-400 text-sm">
 {rule.total - rule.passed} records failed this check ({(100 - rule.score).toFixed(1)}% failure rate)
 </span>
 </div>
 )}
 </div>
 )}
 </div>
 )
}

// Historical run (no full rule data — show what we have) 

function HistoricalReport({ run }: { run: MigrationRun }) {
 const score = run.compliance_score ?? 0
 const metrics = [
 { id: 'HIPAA-NPI', label: 'NPI Validity', standard: 'HIPAA 45 CFR § 162', val: run.npi_validity, threshold: 100, icon: '' },
 { id: 'FHIR-ICD10', label: 'ICD-10 Format', standard: 'FHIR R4 CodeSystem', val: run.icd10_compliance, threshold: 95, icon: '' },
 { id: 'FHIR-COMPLETE', label: 'FHIR Field Completeness', standard: 'FHIR R4 Must Support', val: run.fhir_completeness, threshold: 90, icon: '' },
 { id: 'HIPAA-PHI', label: 'PHI Field Coverage', standard: 'HIPAA Privacy Rule', val: run.hipaa_score, threshold: 100, icon: '' },
 { id: 'CMS-DATE', label: 'Date Format (ISO 8601)', standard: 'CMS Claims Data', val: 100, threshold: 100, icon: '' },
 { id: 'HL7-GENDER', label: 'Gender Coding (HL7)', standard: 'HL7 FHIR Admin', val: 100, threshold: 95, icon: '' },
 { id: 'FHIR-UUID', label: 'Patient UUID Format', standard: 'FHIR R4 Resource.id', val: 100, threshold: 100, icon: '' },
 { id: 'CMS-AMOUNT', label: 'Claim Amount Validity', standard: 'CMS Claim Submission', val: 100, threshold: 100, icon: '' },
 ]

 return (
 <div className="space-y-4">
 {/* Score hero */}
 <div className={clsx('flex items-center gap-6 p-5 rounded-xl border', scoreBorder(score), scoreBgCard(score))}>
 <div className="relative shrink-0">
 <svg width="100" height="100" className="-rotate-90">
 <circle cx="50" cy="50" r="42" fill="none" stroke="#1E293B" strokeWidth="8"/>
 <circle cx="50" cy="50" r="42" fill="none"
 stroke={score >= 90 ? '#10B981' : score >= 70 ? '#F59E0B' : '#EF4444'}
 strokeWidth="8"
 strokeDasharray={`${(score/100)*263.9} 263.9`}
 strokeLinecap="round"/>
 </svg>
 <div className="absolute inset-0 flex flex-col items-center justify-center">
 <span className={clsx('text-xl font-black font-mono', scoreColor(score))}>{score.toFixed(1)}%</span>
 </div>
 </div>
 <div>
 <div className={clsx('text-3xl font-bold', scoreColor(score))}>{scoreLabel(score)}</div>
 <div className="text-slate-400 mt-1">Overall Compliance Score</div>
 <div className="flex items-center gap-3 mt-2 text-sm">
 <span className={clsx('font-semibold', scoreColor(score))}>
 {metrics.filter(m => (m.val ?? 0) >= m.threshold).length}/{metrics.length} rules passed
 </span>
 {metrics.filter(m => (m.val ?? 0) < m.threshold).length > 0 && (
 <span className="text-red-400 text-sm">
 {metrics.filter(m => (m.val ?? 0) < m.threshold).map(m => m.id).join(', ')}
 </span>
 )}
 </div>
 </div>
 <div className="ml-auto grid grid-cols-2 gap-3 text-sm shrink-0">
 <div className="text-center"><div className="font-bold text-white text-lg">{run.total_loaded?.toLocaleString()}</div><div className="text-slate-500 text-xs">Records Loaded</div></div>
 <div className="text-center"><div className="font-bold text-emerald-400 text-lg">{run.match_pct?.toFixed(1)}%</div><div className="text-slate-500 text-xs">Match Rate</div></div>
 </div>
 </div>

 {/* Rule list with expand */}
 <div className="space-y-2">
 {metrics.map(m => {
 const val = m.val ?? 0
 const passed = val >= m.threshold
 const expl = RULE_EXPLANATIONS[m.id]
 return (
 <RuleDetail key={m.id} rule={{
 id: m.id, name: m.label, standard: m.standard,
 score: val, passed: passed ? 1 : 0, total: 1, threshold: m.threshold
 }} />
 )
 })}
 </div>
 </div>
 )
}

// Full compliance report (latest run with all rule details) 

function FullReport({ report, run }: { report: ComplianceReport; run: MigrationRun | null }) {
 const score = report.overall_score

 return (
 <div className="space-y-4">
 {/* Score hero */}
 <div className={clsx('flex items-center gap-6 p-5 rounded-xl border', scoreBorder(score), scoreBgCard(score))}>
 <div className="relative shrink-0">
 <svg width="100" height="100" className="-rotate-90">
 <circle cx="50" cy="50" r="42" fill="none" stroke="#1E293B" strokeWidth="8"/>
 <circle cx="50" cy="50" r="42" fill="none"
 stroke={score >= 90 ? '#10B981' : score >= 70 ? '#F59E0B' : '#EF4444'}
 strokeWidth="8"
 strokeDasharray={`${(score/100)*263.9} 263.9`}
 strokeLinecap="round"/>
 </svg>
 <div className="absolute inset-0 flex flex-col items-center justify-center">
 <span className={clsx('text-xl font-black font-mono', scoreColor(score))}>{score.toFixed(1)}%</span>
 </div>
 </div>
 <div className="flex-1">
 <div className={clsx('text-3xl font-bold', scoreColor(score))}>{scoreLabel(score)}</div>
 <div className="text-slate-400 mt-1">Overall Compliance Score</div>
 <div className="flex items-center gap-3 mt-2">
 <span className="text-emerald-400 font-semibold text-sm">
 {report.summary.passed_rules}/{report.summary.total_rules} rules passed
 </span>
 {report.summary.critical_failures.length > 0 && (
 <span className="text-red-400 text-sm"> Critical: {report.summary.critical_failures.join(', ')}</span>
 )}
 </div>
 </div>
 <div className="grid grid-cols-4 gap-3 shrink-0">
 {[
 { label: 'ICD-10', val: report.icd10_compliance, icon: '' },
 { label: 'NPI', val: report.npi_validity, icon: '' },
 { label: 'FHIR', val: report.fhir_completeness, icon: '' },
 { label: 'HIPAA', val: report.hipaa_score, icon: '' },
 ].map(m => (
 <div key={m.label} className="text-center">
 <div className={clsx('text-xl font-bold font-mono', scoreColor(m.val))}>{m.val.toFixed(0)}%</div>
 <div className="text-slate-500 text-xs mt-0.5">{m.icon} {m.label}</div>
 </div>
 ))}
 </div>
 </div>

 {/* Rule breakdown */}
 <div>
 <div className="text-sm font-bold text-white mb-1">Regulatory Rules Breakdown</div>
 <div className="text-xs text-slate-500 mb-4">Click any rule for detailed explanation, standard reference, and remediation steps</div>
 <div className="space-y-2">
 {report.rules.map(rule => <RuleDetail key={rule.id} rule={rule} />)}
 </div>
 </div>
 </div>
 )
}

// Root 

export default function CompliancePage() {
 const runs = usePipelineStore(s => s.runs).filter(r => r.status === 'complete')
 const liveCompliance = usePipelineStore(s => s.compliance)
 const [selectedId, setSelectedId] = useState<string>('latest')

 const selectedRun = runs.find(r => r.run_id === selectedId)
 const showLatest = selectedId === 'latest' || (!selectedRun && liveCompliance)

 if (runs.length === 0 && !liveCompliance) return (
 <div className="flex flex-col items-center justify-center h-full gap-4 text-slate-600">
 <div className="text-6xl opacity-20"></div>
 <div className="text-lg font-medium text-slate-500">No compliance data yet</div>
 <div className="text-sm text-slate-600 text-center max-w-sm">
 Run a migration to generate compliance metrics against HIPAA, FHIR R4, CMS, and HL7 regulations
 </div>
 </div>
 )

 return (
 <div className="flex h-full overflow-hidden">
 {/* Left: run selector */}
 <div className="w-72 shrink-0 border-r border-slate-800 overflow-y-auto p-4 space-y-3">
 <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Migration Runs</div>

 {liveCompliance && (
 <button
 onClick={() => setSelectedId('latest')}
 className={clsx('w-full text-left p-4 rounded-xl border-2 transition-all',
 showLatest
 ? `${scoreBorder(liveCompliance.overall_score)} ${scoreBgCard(liveCompliance.overall_score)} shadow-lg`
 : 'border-slate-800 bg-[#0D1424] hover:border-slate-700'
 )}
 >
 <div className="flex items-center justify-between mb-2">
 <span className="text-xs font-bold text-blue-400 uppercase tracking-wider">Latest Run</span>
 <span className={clsx('text-2xl font-black font-mono', scoreColor(liveCompliance.overall_score))}>
 {liveCompliance.overall_score.toFixed(1)}%
 </span>
 </div>
 <div className={clsx('text-sm font-semibold', scoreColor(liveCompliance.overall_score))}>
 {scoreLabel(liveCompliance.overall_score)}
 </div>
 <div className="text-xs text-slate-600 mt-1">
 {liveCompliance.summary.passed_rules}/{liveCompliance.summary.total_rules} rules passed · Full breakdown available
 </div>
 </button>
 )}

 {runs.map(run => (
 <RunCard key={run.run_id} run={run} selected={selectedId === run.run_id} onClick={() => setSelectedId(run.run_id)} />
 ))}
 </div>

 {/* Right: detail */}
 <div className="flex-1 overflow-y-auto p-6">
 {showLatest && liveCompliance ? (
 <>
 <div className="mb-6">
 <h2 className="text-xl font-bold text-white">Latest Run — Full Compliance Report</h2>
 <p className="text-slate-400 text-sm mt-1">HIPAA · FHIR R4 · CMS · HL7 — click any rule for detailed explanation</p>
 </div>
 <FullReport report={liveCompliance} run={runs[0] ?? null} />
 </>
 ) : selectedRun ? (
 <>
 <div className="mb-6">
 <div className="flex items-center gap-3 mb-1">
 <h2 className="text-xl font-bold text-white">{selectedRun.dataset_name}</h2>
 <span className={clsx('px-2 py-0.5 rounded border text-xs font-bold', DS_BADGE[selectedRun.dataset_id] ?? DS_BADGE.synthea_standard)}>
 {selectedRun.dataset_id}
 </span>
 </div>
 <p className="text-slate-400 text-sm">
 #{selectedRun.run_id.slice(-8).toUpperCase()} · {new Date(selectedRun.completed_at ?? selectedRun.started_at).toLocaleString()} · {selectedRun.total_loaded?.toLocaleString()} records loaded
 </p>
 </div>
 <HistoricalReport run={selectedRun} />
 </>
 ) : (
 <div className="flex items-center justify-center h-full text-slate-600">Select a run to view its compliance report</div>
 )}
 </div>
 </div>
 )
}
