import { useEffect, useState } from 'react'
import clsx from 'clsx'
import { usePipelineStore } from '../store/pipelineStore'
import { DatasetInfo } from '../types/pipeline'
import { apiUrl } from '../api/client'

const COLOR_MAP: Record<string, { border: string; badge: string; bg: string; selectedBorder: string }> = {
  blue: { border: 'border-slate-200', badge: 'bg-blue-100 text-blue-700 border-blue-200', bg: 'bg-white', selectedBorder: 'border-blue-500' },
  emerald: { border: 'border-slate-200', badge: 'bg-emerald-100 text-emerald-700 border-emerald-200', bg: 'bg-white', selectedBorder: 'border-emerald-500' },
  red: { border: 'border-slate-200', badge: 'bg-red-100 text-red-700 border-red-200', bg: 'bg-white', selectedBorder: 'border-red-400' },
  amber: { border: 'border-slate-200', badge: 'bg-amber-100 text-amber-700 border-amber-200', bg: 'bg-white', selectedBorder: 'border-amber-400' },
}

interface Props { onSelect: (id: string) => void; selected: string }

export default function DatasetSelector({ onSelect, selected }: Props) {
  const [datasets, setDatasets] = useState<DatasetInfo[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(apiUrl('/api/datasets')).then(r => r.json()).then(d => {
      setDatasets((Array.isArray(d) ? d : []).filter(ds => !String(ds.id).startsWith('tiny_')))
      setLoading(false)
    })
  }, [])

  if (loading) return (
    <div className="flex items-center gap-2 text-slate-500 text-sm py-4">
      <span className="w-4 h-4 border-2 border-slate-300 border-t-blue-500 rounded-full animate-spin" />
      Loading datasets...
    </div>
  )

  return (
    <div className="grid grid-cols-2 gap-3">
      {datasets.map(ds => {
        const c = COLOR_MAP[ds.color] ?? COLOR_MAP.blue
        const isSelected = selected === ds.id
        return (
          <button key={ds.id} onClick={() => onSelect(ds.id)}
            className={clsx('relative text-left p-4 rounded-2xl border-2 transition-all shadow-sm hover:shadow-md bg-white',
              isSelected ? c.selectedBorder : 'border-slate-200 hover:border-slate-300'
            )}>
            {isSelected && (
              <div className="absolute top-3 right-3 w-5 h-5 rounded-full bg-blue-600 flex items-center justify-center">
                <span className="text-white text-xs font-bold">&#10003;</span>
              </div>
            )}
            <div className="flex items-start gap-3 mb-3">
              <span className={clsx('px-2 py-0.5 rounded-md text-[11px] font-bold border', c.badge)}>{ds.badge}</span>
            </div>
            <div className="text-slate-900 font-bold text-sm mb-1">{ds.name}</div>
            <div className="text-slate-500 text-xs mb-3 leading-relaxed">{ds.description}</div>
            <div className="flex gap-3 text-xs">
              <div className="text-center"><div className="font-bold text-slate-900 font-mono">{ds.members}</div><div className="text-slate-500">members</div></div>
              <div className="text-center"><div className="font-bold text-slate-900 font-mono">{ds.claims}</div><div className="text-slate-500">claims</div></div>
              <div className="text-center"><div className="font-bold text-blue-700 font-mono">{ds.total}</div><div className="text-slate-500">total</div></div>
            </div>
          </button>
        )
      })}
    </div>
  )
}
