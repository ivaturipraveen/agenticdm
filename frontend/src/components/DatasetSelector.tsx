import { useEffect, useState } from 'react'
import clsx from 'clsx'
import { usePipelineStore } from '../store/pipelineStore'
import { DatasetInfo } from '../types/pipeline'

const COLOR_MAP: Record<string, { border: string; badge: string; glow: string; bg: string }> = {
 blue: { border: 'border-blue-500/50', badge: 'bg-blue-500/15 text-blue-400', glow: 'shadow-blue-500/10', bg: 'bg-blue-500/5' },
 emerald: { border: 'border-emerald-500/50', badge: 'bg-emerald-500/15 text-emerald-400', glow: 'shadow-emerald-500/10', bg: 'bg-emerald-500/5' },
 red: { border: 'border-red-500/50', badge: 'bg-red-500/15 text-red-400', glow: 'shadow-red-500/10', bg: 'bg-red-500/5' },
 amber: { border: 'border-amber-500/50', badge: 'bg-amber-500/15 text-amber-400', glow: 'shadow-amber-500/10', bg: 'bg-amber-500/5' },
}

interface Props {
 onSelect: (id: string) => void
 selected: string
}

export default function DatasetSelector({ onSelect, selected }: Props) {
 const [datasets, setDatasets] = useState<DatasetInfo[]>([])
 const [loading, setLoading] = useState(true)

 useEffect(() => {
 fetch('/api/datasets').then(r => r.json()).then(d => { setDatasets(d); setLoading(false) })
 }, [])

 if (loading) return (
 <div className="flex items-center gap-2 text-slate-500 text-sm py-4">
 <span className="w-4 h-4 border-2 border-slate-700 border-t-blue-500 rounded-full animate-spin" />
 Loading datasets...
 </div>
 )

 return (
 <div className="grid grid-cols-2 gap-3">
 {datasets.map(ds => {
 const c = COLOR_MAP[ds.color] ?? COLOR_MAP.blue
 const isSelected = selected === ds.id
 return (
 <button
 key={ds.id}
 onClick={() => onSelect(ds.id)}
 className={clsx(
 'relative text-left p-4 rounded-xl border-2 transition-all shadow-lg',
 isSelected
 ? `${c.border} ${c.bg} ${c.glow} shadow-xl`
 : 'border-slate-800 bg-[#0D1424] hover:border-slate-700',
 )}
 >
 {isSelected && (
 <div className="absolute top-3 right-3 w-5 h-5 rounded-full bg-blue-500 flex items-center justify-center">
 <span className="text-white text-xs font-bold"></span>
 </div>
 )}
 <div className="flex items-start gap-3 mb-3">
 <span className={clsx('px-2 py-0.5 rounded-md text-[11px] font-bold border', c.badge, c.border)}>
 {ds.badge}
 </span>
 </div>
 <div className="text-white font-bold text-sm mb-1">{ds.name}</div>
 <div className="text-slate-500 text-xs mb-3 leading-relaxed">{ds.description}</div>
 <div className="flex gap-3 text-xs">
 <div className="text-center">
 <div className="font-bold text-white font-mono">{ds.members}</div>
 <div className="text-slate-600">members</div>
 </div>
 <div className="text-center">
 <div className="font-bold text-white font-mono">{ds.claims}</div>
 <div className="text-slate-600">claims</div>
 </div>
 <div className="text-center">
 <div className="font-bold text-blue-400 font-mono">{ds.total}</div>
 <div className="text-slate-600">total</div>
 </div>
 </div>
 </button>
 )
 })}
 </div>
 )
}
