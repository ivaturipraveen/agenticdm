import { useEffect, useState, useMemo } from 'react'
import clsx from 'clsx'

// Types 

interface ColDef { name: string; type: string }
interface DiffField { before: unknown; after: unknown; added?: boolean }

interface DataViewResult {
 table: string
 dataset_id: string
 columns: ColDef[]
 source_rows: Record<string, unknown>[]
 transformed_rows: Record<string, unknown>[]
 anomalies: Record<string, unknown>[]
 diffs: Record<string, DiffField>[]
 stats: { total: number; success: number; anomaly_count: number; icd_fixes: number; id_fixes: number; null_fixes: number }
 total_source: number
}

const TABLE_INFO: Record<string, { icon: string; fhir: string; color: string; description: string }> = {
 members: { icon: '', fhir: 'Patient', color: 'blue', description: 'Member demographics FHIR Patient resource' },
 eligibility: { icon: '', fhir: 'Coverage', color: 'violet', description: 'Insurance eligibility FHIR Coverage resource' },
 claims: { icon: '', fhir: 'Claim', color: 'emerald', description: 'Medical claims FHIR Claim resource' },
}

const COLOR: Record<string, Record<string, string>> = {
 blue: { border: 'border-blue-500/30', bg: 'bg-blue-500/10', text: 'text-blue-400', badge: 'bg-blue-500/15 text-blue-400' },
 violet: { border: 'border-violet-500/30', bg: 'bg-violet-500/10', text: 'text-violet-400', badge: 'bg-violet-500/15 text-violet-400' },
 emerald: { border: 'border-emerald-500/30', bg: 'bg-emerald-500/10', text: 'text-emerald-400', badge: 'bg-emerald-500/15 text-emerald-400' },
}

// Helpers 

function fmt(v: unknown): string {
 if (v === null || v === undefined) return 'null'
 if (typeof v === 'object') return JSON.stringify(v)
 return String(v)
}

function truncate(s: string, n = 28): string {
 return s.length > n ? s.slice(0, n) + '…' : s
}

// Stats bar 

function StatsBar({ stats, table }: { stats: DataViewResult['stats']; table: string }) {
 const tinfo = TABLE_INFO[table] ?? TABLE_INFO.claims
 const c = COLOR[tinfo.color]

 const items = [
 { label: 'Total Records', val: stats.total.toLocaleString(), color: 'text-white' },
 { label: 'Transformed OK', val: stats.success.toLocaleString(), color: 'text-emerald-400' },
 { label: 'Anomalies', val: stats.anomaly_count.toLocaleString(), color: stats.anomaly_count > 0 ? 'text-amber-400' : 'text-slate-500' },
 ...(table === 'claims' ? [
 { label: 'ICD-10 Fixed', val: stats.icd_fixes.toLocaleString(), color: stats.icd_fixes > 0 ? 'text-blue-400' : 'text-slate-500' },
 ] : []),
 { label: 'ID Reformatted', val: stats.id_fixes.toLocaleString(), color: stats.id_fixes > 0 ? 'text-violet-400' : 'text-slate-500' },
 { label: 'Nulls Handled', val: stats.null_fixes.toLocaleString(), color: stats.null_fixes > 0 ? 'text-amber-400' : 'text-slate-500' },
 ]

 return (
 <div className={clsx('flex items-center gap-6 px-5 py-3 rounded-xl border mb-4', c.border, c.bg + '/20')}>
 <div className="flex items-center gap-2 shrink-0">
 <span className="text-2xl">{tinfo.icon}</span>
 <div>
 <div className={clsx('font-bold text-sm', c.text)}>{table} FHIR {tinfo.fhir}</div>
 <div className="text-slate-500 text-xs">{tinfo.description}</div>
 </div>
 </div>
 <div className="h-8 w-px bg-slate-700 shrink-0" />
 {items.map(item => (
 <div key={item.label} className="text-center shrink-0">
 <div className={clsx('text-lg font-bold font-mono', item.color)}>{item.val}</div>
 <div className="text-[10px] text-slate-600">{item.label}</div>
 </div>
 ))}
 </div>
 )
}

// Field diff badge 

function DiffBadge({ diff }: { diff: DiffField | undefined }) {
 if (!diff) return null
 if (diff.added) return (
 <span className="inline-flex items-center gap-0.5 px-1 py-0.5 bg-blue-500/15 border border-blue-500/30 rounded text-[9px] text-blue-400 font-bold">
 +NEW
 </span>
 )
 return (
 <span className="inline-flex items-center gap-0.5 px-1 py-0.5 bg-amber-500/15 border border-amber-500/30 rounded text-[9px] text-amber-400 font-bold">
 CHANGED
 </span>
 )
}

// Side-by-side row viewer 

function RecordDiffModal({ rowIndex, source, transformed, diff, columns, onClose }: {
 rowIndex: number
 source: Record<string, unknown>
 transformed: Record<string, unknown>
 diff: Record<string, DiffField>
 columns: ColDef[]
 onClose: () => void
}) {
 const allKeys = Array.from(new Set([...columns.map(c => c.name), ...Object.keys(transformed)]))
 .filter(k => k !== 'dataset_id')

 return (
 <div className="fixed inset-0 z-50 flex items-center justify-center">
 <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
 <div className="relative z-10 w-full max-w-5xl mx-4 bg-[#0D1424] border border-slate-700 rounded-2xl shadow-2xl overflow-hidden max-h-[85vh] flex flex-col">
 {/* Header */}
 <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 shrink-0">
 <div>
 <div className="text-white font-bold text-lg">Record #{rowIndex + 1} — Field-by-Field Diff</div>
 <div className="text-slate-400 text-sm mt-0.5">
 {Object.keys(diff).length > 0
 ? `${Object.keys(diff).length} field${Object.keys(diff).length !== 1 ? 's' : ''} changed by Transformation Agent`
 : 'No changes — record passed through unchanged'}
 </div>
 </div>
 <button onClick={onClose} className="text-slate-400 hover:text-white text-2xl leading-none"></button>
 </div>

 {/* Table */}
 <div className="flex-1 overflow-y-auto">
 <table className="w-full text-sm">
 <thead className="sticky top-0 bg-[#0D1424] border-b border-slate-800">
 <tr>
 <th className="text-left px-4 py-3 text-slate-500 font-semibold text-xs w-44">Field</th>
 <th className="text-left px-4 py-3 text-slate-500 font-semibold text-xs">Type</th>
 <th className="text-left px-4 py-3 text-slate-400 font-semibold text-xs bg-red-500/[0.03] border-l border-red-500/20">
 Source (PostgreSQL)
 </th>
 <th className="text-left px-4 py-3 text-slate-400 font-semibold text-xs bg-emerald-500/[0.03] border-l border-emerald-500/20">
 Transformed (FHIR-ready)
 </th>
 <th className="text-left px-4 py-3 text-slate-500 font-semibold text-xs w-28">Status</th>
 </tr>
 </thead>
 <tbody>
 {allKeys.map((key) => {
 const srcVal = source[key]
 const tgtVal = transformed[key]
 const changed = diff[key]
 const isChanged = !!changed && !changed.added
 const isAdded = changed?.added
 const rowClass = isChanged
 ? 'bg-amber-500/[0.04] border-l-2 border-amber-500/40'
 : isAdded
 ? 'bg-blue-500/[0.03] border-l-2 border-blue-500/30'
 : 'border-l-2 border-transparent'

 return (
 <tr key={key} className={clsx('border-b border-slate-800/40 hover:bg-slate-800/20', rowClass)}>
 <td className="px-4 py-3 font-mono text-slate-300 font-semibold text-xs">{key}</td>
 <td className="px-4 py-3 text-slate-600 text-xs font-mono">
 {columns.find(c => c.name === key)?.type.replace('character varying', 'varchar').replace('timestamp without time zone', 'ts') ?? '—'}
 </td>
 <td className={clsx('px-4 py-3 font-mono text-sm border-l border-slate-800', isChanged ? 'text-red-300' : 'text-slate-400')}>
 {srcVal === null || srcVal === undefined
 ? <span className="text-slate-700 italic">null</span>
 : <span title={fmt(srcVal)}>{truncate(fmt(srcVal), 50)}</span>
 }
 </td>
 <td className={clsx('px-4 py-3 font-mono text-sm border-l border-slate-800', isChanged ? 'text-emerald-300 font-semibold' : isAdded ? 'text-blue-300' : 'text-slate-400')}>
 {tgtVal === null || tgtVal === undefined
 ? <span className="text-slate-700 italic">null</span>
 : <span title={fmt(tgtVal)}>{truncate(fmt(tgtVal), 50)}</span>
 }
 </td>
 <td className="px-4 py-3">
 {isChanged ? (
 <span className="px-2 py-0.5 rounded-md bg-amber-500/15 text-amber-400 text-[10px] font-bold border border-amber-500/30"> MODIFIED</span>
 ) : isAdded ? (
 <span className="px-2 py-0.5 rounded-md bg-blue-500/15 text-blue-400 text-[10px] font-bold border border-blue-500/30">+ ADDED</span>
 ) : (
 <span className="px-2 py-0.5 rounded-md bg-slate-800 text-slate-600 text-[10px]">— unchanged</span>
 )}
 </td>
 </tr>
 )
 })}
 </tbody>
 </table>
 </div>
 </div>
 </div>
 )
}

// Main table view 

function DataTable({ data, activeTab }: { data: DataViewResult; activeTab: 'source' | 'transformed' | 'diff' }) {
 const [selectedRow, setSelectedRow] = useState<number | null>(null)
 const [search, setSearch] = useState('')

 const rows = activeTab === 'source' ? data.source_rows
 : activeTab === 'transformed' ? data.transformed_rows
 : data.source_rows // diff uses source + overlay

 const visibleCols = data.columns
 .filter(c => c.name !== 'dataset_id')
 .slice(0, activeTab === 'diff' ? 8 : 10)

 const filtered = useMemo(() => {
 if (!search) return rows
 const q = search.toLowerCase()
 return rows.filter(row => Object.values(row).some(v => String(v ?? '').toLowerCase().includes(q)))
 }, [rows, search])

 return (
 <>
 {/* Search */}
 <div className="flex items-center gap-3 mb-3">
 <input
 type="text"
 placeholder={`Search ${data.table}...`}
 value={search}
 onChange={e => setSearch(e.target.value)}
 className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-slate-300 placeholder-slate-600 focus:outline-none focus:border-blue-500 w-64"
 />
 <span className="text-xs text-slate-600">{filtered.length} of {rows.length} records shown</span>
 {activeTab === 'diff' && (
 <span className="text-xs text-amber-400">
 Amber = modified field &nbsp; Blue = added field &nbsp; Click any row for full diff
 </span>
 )}
 </div>

 <div className="overflow-auto rounded-xl border border-slate-800">
 <table className="w-full text-xs">
 <thead>
 <tr className="bg-slate-900/60 border-b border-slate-800 sticky top-0">
 <th className="px-3 py-3 text-slate-600 font-semibold text-left w-10">#</th>
 {visibleCols.map(col => (
 <th key={col.name} className="px-3 py-3 text-left">
 <div className="font-mono font-bold text-slate-300">{col.name}</div>
 <div className="text-slate-700 text-[10px]">{col.type.replace('character varying','varchar').replace('timestamp without time zone','ts')}</div>
 </th>
 ))}
 {activeTab === 'diff' && <th className="px-3 py-3 text-slate-600 font-semibold text-left w-24">Changes</th>}
 {visibleCols.length < data.columns.length - 1 && (
 <th className="px-3 py-3 text-slate-700 text-left">+{data.columns.length - 1 - visibleCols.length} more</th>
 )}
 </tr>
 </thead>
 <tbody>
 {filtered.map((row, rowIdx) => {
 const srcRow = data.source_rows[rowIdx]
 const tgtRow = data.transformed_rows[rowIdx]
 const diff = data.diffs[rowIdx] ?? {}
 const hasChanges = Object.keys(diff).length > 0

 return (
 <tr
 key={rowIdx}
 onClick={() => activeTab === 'diff' ? setSelectedRow(rowIdx) : undefined}
 className={clsx(
 'border-b border-slate-800/50 last:border-0 transition-colors',
 activeTab === 'diff' && 'cursor-pointer hover:bg-slate-800/30',
 activeTab === 'diff' && hasChanges ? 'bg-amber-500/[0.02]' : '',
 rowIdx % 2 === 0 ? '' : 'bg-slate-900/20'
 )}
 >
 <td className="px-3 py-2.5 text-slate-700 font-mono">{rowIdx + 1}</td>
 {visibleCols.map(col => {
 const srcVal = srcRow?.[col.name]
 const tgtVal = tgtRow?.[col.name]
 const fieldDiff = diff[col.name]
 const isModified = activeTab === 'diff' && !!fieldDiff && !fieldDiff.added
 const isAdded = activeTab === 'diff' && fieldDiff?.added

 const displayVal = activeTab === 'transformed' ? tgtVal ?? row[col.name]
 : activeTab === 'diff' ? srcVal
 : row[col.name]

 return (
 <td key={col.name} className={clsx(
 'px-3 py-2.5 font-mono text-sm',
 isModified ? 'bg-amber-500/10' : isAdded ? 'bg-blue-500/10' : ''
 )}>
 <div className="flex items-center gap-1.5">
 {displayVal === null || displayVal === undefined
 ? <span className="text-slate-700 italic text-xs">null</span>
 : <span className={clsx('truncate max-w-[140px] block',
 isModified ? 'text-amber-300' : isAdded ? 'text-blue-300' : 'text-slate-300'
 )} title={fmt(displayVal)}>
 {truncate(fmt(displayVal))}
 </span>
 }
 {isModified && (
 <span className="shrink-0 text-[9px] text-amber-400"></span>
 )}
 </div>
 {isModified && activeTab === 'diff' && (
 <div className="text-[9px] text-emerald-400 mt-0.5 truncate max-w-[140px]" title={fmt(tgtVal)}>
 {truncate(fmt(tgtVal), 20)}
 </div>
 )}
 </td>
 )
 })}
 {activeTab === 'diff' && (
 <td className="px-3 py-2.5">
 {hasChanges ? (
 <span className="px-2 py-0.5 rounded bg-amber-500/15 text-amber-400 text-[9px] font-bold border border-amber-500/30">
 {Object.keys(diff).length} change{Object.keys(diff).length !== 1 ? 's' : ''}
 </span>
 ) : (
 <span className="text-slate-700 text-[9px]">—</span>
 )}
 </td>
 )}
 {visibleCols.length < data.columns.length - 1 && <td />}
 </tr>
 )
 })}
 </tbody>
 </table>

 {filtered.length === 0 && (
 <div className="py-12 text-center text-slate-600 text-sm">No records match your search</div>
 )}
 </div>

 {/* Record diff modal */}
 {selectedRow !== null && activeTab === 'diff' && (
 <RecordDiffModal
 rowIndex={selectedRow}
 source={data.source_rows[selectedRow]}
 transformed={data.transformed_rows[selectedRow]}
 diff={data.diffs[selectedRow] ?? {}}
 columns={data.columns}
 onClose={() => setSelectedRow(null)}
 />
 )}
 </>
 )
}

// Anomaly table 

function AnomalyTable({ anomalies, columns }: { anomalies: Record<string, unknown>[]; columns: ColDef[] }) {
 if (anomalies.length === 0) return (
 <div className="py-12 text-center text-slate-600">
 <div className="text-4xl mb-3"></div>
 <div className="text-base font-medium text-slate-500">No anomalies quarantined</div>
 <div className="text-sm mt-1">All records passed transformation rules</div>
 </div>
 )

 const cols = columns.filter(c => c.name !== 'dataset_id').slice(0, 6)

 return (
 <div>
 <div className="flex items-center gap-2 mb-3">
 <span className="px-2 py-0.5 bg-red-500/15 text-red-400 border border-red-500/30 rounded text-xs font-bold">
 {anomalies.length} Anomalies Quarantined
 </span>
 <span className="text-xs text-slate-500">These records had critical data issues and were not loaded to FHIR</span>
 </div>
 <div className="overflow-auto rounded-xl border border-red-500/20">
 <table className="w-full text-xs">
 <thead>
 <tr className="bg-red-500/5 border-b border-red-500/20">
 {cols.map(col => (
 <th key={col.name} className="px-3 py-3 text-left font-mono font-bold text-slate-300">{col.name}</th>
 ))}
 <th className="px-3 py-3 text-left text-slate-400">Reason</th>
 </tr>
 </thead>
 <tbody>
 {anomalies.map((row, i) => (
 <tr key={i} className="border-b border-slate-800/40 last:border-0 bg-red-500/[0.02]">
 {cols.map(col => (
 <td key={col.name} className="px-3 py-2.5 font-mono text-red-300">
 {row[col.name] === null ? <span className="text-slate-700 italic">null</span> : truncate(fmt(row[col.name]))}
 </td>
 ))}
 <td className="px-3 py-2.5 text-red-400 text-[10px]">
 {fmt((row as Record<string, unknown>)['anomaly_reasons'] ?? 'Data quality issue')}
 </td>
 </tr>
 ))}
 </tbody>
 </table>
 </div>
 </div>
 )
}

// Root 

interface Props {
 runId: string
 datasetName: string
}

export default function DataView({ runId, datasetName }: Props) {
 const [activeTable, setActiveTable] = useState<'members' | 'eligibility' | 'claims'>('claims')
 const [activeTab, setActiveTab] = useState<'source' | 'transformed' | 'diff' | 'anomalies'>('diff')
 const [data, setData] = useState<DataViewResult | null>(null)
 const [loading, setLoading] = useState(false)

 useEffect(() => {
 setLoading(true)
 setData(null)
 fetch(`/api/runs/${runId}/data-view?table=${activeTable}&limit=30`)
 .then(r => r.json())
 .then(d => { setData(d); setLoading(false) })
 .catch(() => setLoading(false))
 }, [runId, activeTable])

 const tinfo = TABLE_INFO[activeTable]

 const changedCount = data?.diffs.filter(d => Object.keys(d).length > 0).length ?? 0
 const unchangedCount = (data?.total_source ?? 0) - changedCount

 return (
 <div className="flex flex-col h-full overflow-hidden">
 {/* Page header */}
 <div className="px-5 py-4 border-b border-slate-800 shrink-0">
 <div className="flex items-center justify-between">
 <div>
 <h2 className="text-lg font-bold text-white"> Source FHIR Data View</h2>
 <p className="text-slate-400 text-sm mt-0.5">
 {datasetName} — inspect original records vs transformed FHIR-ready output, field by field
 </p>
 </div>
 {data && (
 <div className="flex items-center gap-4 text-sm shrink-0">
 <div className="text-center">
 <div className="text-white font-bold font-mono">{data.total_source}</div>
 <div className="text-slate-600 text-xs">records</div>
 </div>
 <div className="text-center">
 <div className="text-amber-400 font-bold font-mono">{changedCount}</div>
 <div className="text-slate-600 text-xs">modified</div>
 </div>
 <div className="text-center">
 <div className="text-emerald-400 font-bold font-mono">{unchangedCount}</div>
 <div className="text-slate-600 text-xs">unchanged</div>
 </div>
 {data.anomalies.length > 0 && (
 <div className="text-center">
 <div className="text-red-400 font-bold font-mono">{data.anomalies.length}</div>
 <div className="text-slate-600 text-xs">anomalies</div>
 </div>
 )}
 </div>
 )}
 </div>
 </div>

 {/* Table selector */}
 <div className="flex items-center gap-2 px-5 py-3 border-b border-slate-800 shrink-0 bg-slate-900/30">
 {(['members', 'eligibility', 'claims'] as const).map(t => {
 const ti = TABLE_INFO[t]
 const c = COLOR[ti.color]
 return (
 <button
 key={t}
 onClick={() => setActiveTable(t)}
 className={clsx(
 'flex items-center gap-2 px-4 py-2 rounded-xl border text-sm font-medium transition-all',
 activeTable === t ? `${c.border} ${c.bg} ${c.text}` : 'border-slate-800 text-slate-500 hover:border-slate-700 hover:text-slate-300'
 )}
 >
 <span>{ti.icon}</span>
 <span className="capitalize">{t}</span>
 <span className="text-xs font-mono"> {ti.fhir}</span>
 </button>
 )
 })}
 <div className="ml-auto text-xs text-slate-600">Showing 30 sample records</div>
 </div>

 {/* View tabs */}
 <div className="flex items-center gap-0 border-b border-slate-800 shrink-0 px-5">
 {[
 { id: 'diff' as const, label: ' Diff View', desc: 'side by side changes' },
 { id: 'source' as const, label: ' Source (Original)', desc: 'PostgreSQL data as-is' },
 { id: 'transformed' as const, label: ' Transformed', desc: 'FHIR-ready output' },
 { id: 'anomalies' as const, label: ` Anomalies${data?.anomalies.length ? ` (${data.anomalies.length})` : ''}`, desc: 'quarantined records' },
 ].map(tab => (
 <button
 key={tab.id}
 onClick={() => setActiveTab(tab.id)}
 className={clsx(
 'flex items-center gap-1.5 px-4 py-3 text-sm font-medium border-b-2 transition-all',
 activeTab === tab.id ? 'border-blue-500 text-white' : 'border-transparent text-slate-500 hover:text-slate-300'
 )}
 >
 {tab.label}
 </button>
 ))}
 </div>

 {/* Content */}
 <div className="flex-1 overflow-y-auto p-5 min-h-0">
 {loading ? (
 <div className="flex items-center justify-center h-full gap-2 text-slate-500">
 <div className="w-5 h-5 border-2 border-slate-700 border-t-blue-500 rounded-full animate-spin" />
 Loading {activeTable} data...
 </div>
 ) : !data ? (
 <div className="flex items-center justify-center h-full text-slate-600">Failed to load data</div>
 ) : (
 <>
 <StatsBar stats={data.stats} table={activeTable} />

 {activeTab === 'anomalies' ? (
 <AnomalyTable anomalies={data.anomalies} columns={data.columns} />
 ) : (
 <DataTable data={data} activeTab={activeTab} />
 )}
 </>
 )}
 </div>
 </div>
 )
}
