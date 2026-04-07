import { useEffect, useState } from 'react'
import clsx from 'clsx'

interface TableData {
 count: number
 columns: { name: string; type: string }[]
 sample: Record<string, unknown>[]
}

interface DbPreview {
 members: TableData
 eligibility: TableData
 claims: TableData
}

const TABLE_COLORS: Record<string, string> = {
 members: 'text-blue-400 bg-blue-500/10 border-blue-500/30',
 eligibility: 'text-purple-400 bg-purple-500/10 border-purple-500/30',
 claims: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30',
}

const FHIR_MAP: Record<string, string> = {
 members: 'Patient',
 eligibility: 'Coverage',
 claims: 'Claim',
}

export default function DatabasePanel() {
 const [data, setData] = useState<DbPreview | null>(null)
 const [loading, setLoading] = useState(true)
 const [activeTable, setActiveTable] = useState<string>('members')
 const [error, setError] = useState('')

 useEffect(() => {
 fetch('/api/db/preview')
 .then(r => r.json())
 .then(d => { setData(d); setLoading(false) })
 .catch(e => { setError(String(e)); setLoading(false) })
 }, [])

 if (loading) return (
 <div className="flex items-center justify-center h-full gap-2 text-slate-500 text-sm">
 <span className="w-4 h-4 border-2 border-slate-600 border-t-blue-500 rounded-full animate-spin" />
 Loading database preview...
 </div>
 )

 if (error || !data) return (
 <div className="flex items-center justify-center h-full text-red-400 text-sm">{error || 'Failed to load'}</div>
 )

 const tableInfo = data[activeTable as keyof DbPreview]

 return (
 <div className="flex flex-col h-full bg-[#0D1424] border border-slate-800 rounded-xl overflow-hidden">
 {/* Header */}
 <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 shrink-0">
 <div className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Source Database</div>
 <div className="flex items-center gap-2">
 <div className="w-2 h-2 rounded-full bg-emerald-400" />
 <span className="text-xs text-emerald-400 font-medium">Connected</span>
 <span className="text-xs text-slate-600 font-mono ml-1">Render PostgreSQL</span>
 </div>
 </div>

 {/* Table summary cards */}
 <div className="grid grid-cols-3 gap-3 p-3 shrink-0 border-b border-slate-800">
 {Object.entries(data).map(([table, info]) => (
 <button
 key={table}
 onClick={() => setActiveTable(table)}
 className={clsx(
 'rounded-lg border p-3 text-left transition-all',
 activeTable === table
 ? TABLE_COLORS[table]
 : 'border-slate-800 bg-slate-900/40 hover:border-slate-700'
 )}
 >
 <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">{table}</div>
 <div className="text-xl font-bold text-white mt-1">{info.count.toLocaleString()}</div>
 <div className="text-[10px] text-slate-500 mt-0.5"> FHIR {FHIR_MAP[table]}</div>
 </button>
 ))}
 </div>

 {/* Column list */}
 <div className="shrink-0 px-4 py-2 border-b border-slate-800 bg-slate-900/30">
 <div className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold mb-1.5">
 {activeTable} — {tableInfo.columns.length} columns
 </div>
 <div className="flex flex-wrap gap-1.5">
 {tableInfo.columns.map(col => (
 <span key={col.name} className="inline-flex items-center gap-1 px-2 py-0.5 bg-slate-800 border border-slate-700 rounded text-[10px] text-slate-400 font-mono">
 {col.name}
 <span className="text-slate-600">{col.type.replace('character varying', 'varchar').replace('timestamp without time zone', 'timestamp')}</span>
 </span>
 ))}
 </div>
 </div>

 {/* Sample rows */}
 <div className="flex-1 overflow-auto">
 <div className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold px-4 pt-3 pb-1.5 sticky top-0 bg-[#0D1424]">
 Sample Records (5 rows)
 </div>
 <div className="overflow-x-auto px-4 pb-4">
 <table className="text-xs w-full">
 <thead>
 <tr className="border-b border-slate-800">
 {tableInfo.columns.slice(0, 7).map(col => (
 <th key={col.name} className="text-left text-[10px] text-slate-500 font-semibold pb-1.5 pr-4 font-mono whitespace-nowrap">
 {col.name}
 </th>
 ))}
 {tableInfo.columns.length > 7 && <th className="text-slate-600 text-[10px]">+{tableInfo.columns.length - 7}</th>}
 </tr>
 </thead>
 <tbody>
 {tableInfo.sample.map((row, i) => (
 <tr key={i} className="border-b border-slate-800/50 hover:bg-slate-800/20">
 {tableInfo.columns.slice(0, 7).map(col => (
 <td key={col.name} className="py-1.5 pr-4 text-slate-400 font-mono text-[10px] whitespace-nowrap max-w-[140px] truncate" title={String(row[col.name] ?? '')}>
 {row[col.name] === null ? <span className="text-slate-700">null</span> : String(row[col.name]).slice(0, 30)}
 </td>
 ))}
 </tr>
 ))}
 </tbody>
 </table>
 </div>
 </div>
 </div>
 )
}
