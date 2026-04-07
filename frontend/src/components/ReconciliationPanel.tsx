import { usePipelineStore } from '../store/pipelineStore'
import { RadialBarChart, RadialBar, ResponsiveContainer, Tooltip } from 'recharts'

function ChecksumRow({ label, passed }: { label: string; passed: boolean }) {
 return (
 <div className="flex items-center justify-between text-xs py-1.5 border-b border-navy-border last:border-0">
 <span className="text-slate-400">{label}</span>
 <span className={passed ? 'text-emerald-400 font-medium' : 'text-red-400 font-medium'}>
 {passed ? ' PASS' : ' FAIL'}
 </span>
 </div>
 )
}

function MetricCard({ label, value, color }: { label: string; value: number | string; color: string }) {
 return (
 <div className="bg-navy rounded-lg border border-navy-border p-3 text-center">
 <div className={`text-2xl font-bold ${color}`}>{typeof value === 'number' ? value.toLocaleString() : value}</div>
 <div className="text-slate-500 text-xs mt-0.5">{label}</div>
 </div>
 )
}

export default function ReconciliationPanel() {
 const reconciliation = usePipelineStore((s) => s.reconciliation)

 if (!reconciliation) {
 return (
 <div className="flex flex-col items-center justify-center h-full text-slate-600 gap-3">
 <div className="text-4xl opacity-30"></div>
 <div className="text-sm text-center">
 Reconciliation report will appear<br />after the QA Agent completes
 </div>
 </div>
 )
 }

 const chartData = [
 { name: 'Match', value: reconciliation.match_pct, fill: '#10B981' },
 { name: 'Gap', value: 100 - reconciliation.match_pct, fill: '#1E293B' },
 ]

 return (
 <div className="flex flex-col gap-4 h-full overflow-y-auto">
 <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider">QA Reconciliation</div>

 {/* Ring Chart */}
 <div className="bg-navy-light rounded-lg border border-navy-border p-4">
 <div className="relative h-36">
 <ResponsiveContainer width="100%" height="100%">
 <RadialBarChart cx="50%" cy="50%" innerRadius="65%" outerRadius="90%" data={chartData} startAngle={90} endAngle={-270}>
 <RadialBar dataKey="value" cornerRadius={4} />
 <Tooltip
 content={() => null}
 />
 </RadialBarChart>
 </ResponsiveContainer>
 <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
 <div className="text-3xl font-bold text-emerald-400">{reconciliation.match_pct}%</div>
 <div className="text-xs text-slate-500">Match Rate</div>
 </div>
 </div>

 <div className="flex justify-between text-center mt-3 pt-3 border-t border-navy-border">
 <div>
 <div className="text-lg font-bold text-white">{reconciliation.source_count.toLocaleString()}</div>
 <div className="text-xs text-slate-500">Source</div>
 </div>
 <div className="text-slate-600 text-lg self-center"></div>
 <div>
 <div className="text-lg font-bold text-blue-400">{reconciliation.target_count.toLocaleString()}</div>
 <div className="text-xs text-slate-500">FHIR Target</div>
 </div>
 </div>
 </div>

 {/* Metric cards */}
 <div className="grid grid-cols-3 gap-2">
 <MetricCard label="Matched" value={reconciliation.matched} color="text-emerald-400" />
 <MetricCard label="Anomalies" value={reconciliation.anomalies_quarantined} color="text-amber-400" />
 <MetricCard label="Violations" value={reconciliation.violations} color={reconciliation.violations > 0 ? 'text-red-400' : 'text-slate-400'} />
 </div>

 {/* Missing */}
 {reconciliation.missing > 0 && (
 <div className="bg-red-500/5 border border-red-500/20 rounded p-2 text-xs text-red-400">
 {reconciliation.missing} records missing from target
 </div>
 )}

 {/* Checksums */}
 <div className="bg-navy-light rounded-lg border border-navy-border p-3">
 <div className="text-xs font-medium text-slate-400 mb-2">Checksum Verification</div>
 <ChecksumRow label="member_id" passed={reconciliation.checksum_member_id} />
 <ChecksumRow label="claim_amount" passed={reconciliation.checksum_claim_amount} />
 <ChecksumRow label="date_of_service" passed={reconciliation.checksum_date_of_service} />
 </div>

 <div className="text-xs text-slate-600 text-center">
 Generated {new Date(reconciliation.generated_at).toLocaleTimeString()}
 </div>
 </div>
 )
}
