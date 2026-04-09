import { useEffect, useState } from 'react'
import { usePipelineStore } from '../store/pipelineStore'
import DatasetSelector from './DatasetSelector'

interface ColDef { name: string; type: string }
interface TableData { count: number; columns: ColDef[]; sample: Record<string, unknown>[] }
interface DbPreview { [key: string]: TableData | undefined }

const FHIR_TARGET: Record<string, string> = { members: 'Patient', eligibility: 'Coverage', claims: 'Claim' }

function TableCard({ name, data }: { name: string; data: TableData }) {
  const [show, setShow] = useState(false)
  return (
    <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm">
      <div className="px-5 py-4 flex items-center justify-between bg-slate-50">
        <div>
          <div className="font-semibold text-slate-900 capitalize text-base">{name}</div>
          <div className="text-xs text-slate-500 mt-1">
            FHIR target: <span className="font-semibold text-blue-700">{FHIR_TARGET[name] || 'Inferred at runtime'}</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-slate-700 text-sm font-mono font-semibold">{data.count.toLocaleString()} rows</span>
          <button onClick={() => setShow(v => !v)} className="px-3 py-1.5 bg-white hover:bg-slate-100 border border-slate-300 rounded-xl text-xs text-slate-700 transition-all">
            {show ? 'Hide sample' : 'Preview rows'}
          </button>
        </div>
      </div>
      <div className="px-5 py-3 border-t border-slate-200 flex flex-wrap gap-2">
        {data.columns.map(col => (
          <span key={col.name} className="inline-flex items-center gap-1.5 px-2 py-1 bg-slate-50 border border-slate-200 rounded-lg text-xs">
            <span className="text-slate-700 font-mono">{col.name}</span>
            <span className="text-[10px] text-slate-400 font-mono">{col.type.replace('character varying', 'varchar')}</span>
          </span>
        ))}
      </div>
      {show && (
        <div className="border-t border-slate-200 overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead><tr className="bg-slate-50">{data.columns.slice(0, 6).map(col => <th key={col.name} className="text-left text-slate-500 font-semibold px-4 py-2.5 whitespace-nowrap font-mono">{col.name}</th>)}</tr></thead>
            <tbody>{data.sample.map((row, i) => <tr key={i} className={i % 2 === 0 ? 'bg-slate-50/40' : ''}>{data.columns.slice(0, 6).map(col => <td key={col.name} className="px-4 py-2 text-slate-700 font-mono whitespace-nowrap max-w-[160px] truncate">{row[col.name] == null ? <span className="text-slate-400">null</span> : String(row[col.name]).slice(0, 28)}</td>)}</tr>)}</tbody>
          </table>
        </div>
      )}
    </div>
  )
}

const STAGES = [
  { num: 1, title: 'Discovery Agent', subtitle: 'Scans tables, infers FHIR resource types, and generates field mapping.' },
  { num: 2, title: 'Transformation Agent', subtitle: 'Converts source rows into valid FHIR R4 records.' },
  { num: 3, title: 'Orchestration Agent', subtitle: 'Validates, holds for approval, then loads to the FHIR target.' },
  { num: 4, title: 'QA / Reconciliation Agent', subtitle: 'Confirms source and output counts match; checks compliance.' },
  { num: 5, title: 'Integration Monitor Agent', subtitle: 'Watches for schema changes that would affect the run.' },
]

export default function PreMigrationView() {
  const [db, setDb] = useState<DbPreview | null>(null)
  const [loading, setLoading] = useState(false)
  const selectedDatasetId = usePipelineStore(s => s.selectedDatasetId)
  const setSelectedDataset = usePipelineStore(s => s.setSelectedDataset)
  const startFn = usePipelineStore(s => s.startPipeline)
  const stage = usePipelineStore(s => s.stage)
  const runId = usePipelineStore(s => s.runId)

  useEffect(() => {
    setLoading(true)
    setDb(null)
    fetch(`/api/datasets/${selectedDatasetId}/preview`)
      .then(r => r.json())
      .then(d => { setDb(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [selectedDatasetId])

  const totalRows = db ? Object.values(db).reduce((s, t) => s + (t?.count || 0), 0) : 0
  const alreadyRunning = !['IDLE', 'COMPLETE', 'HALTED'].includes(stage)

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-7xl mx-auto px-6 py-8 space-y-6">
        {/* Title */}
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Healthcare Data Migration</h1>
          <p className="text-slate-500 mt-2 max-w-2xl">Select a source dataset, inspect the data, then run the pipeline. Each agent reports exactly what it received and what it produced.</p>
        </div>

        <div className="grid grid-cols-[1.1fr_0.9fr] gap-6 items-start">
          {/* Left panel */}
          <div className="space-y-5">
            {/* Dataset selection */}
            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm space-y-5">
              <div>
                <div className="text-slate-900 font-bold text-lg">Select Dataset</div>
                <div className="text-slate-500 text-sm mt-1">Choose the source data to migrate. The preview below updates immediately.</div>
              </div>
              <DatasetSelector selected={selectedDatasetId} onSelect={(id) => { setSelectedDataset(id) }} />
              <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-5 py-4">
                <div>
                  <div className="text-slate-900 font-semibold">{selectedDatasetId}</div>
                  <div className="text-slate-500 text-sm mt-0.5">{loading ? 'Loading…' : `${totalRows.toLocaleString()} source rows ready`}</div>
                </div>
                {alreadyRunning ? (
                  <div className="flex items-center gap-2 px-4 py-2 rounded-xl border border-amber-200 bg-amber-50 text-amber-700 text-sm font-semibold">
                    <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                    Run active — #{runId?.slice(-8).toUpperCase()}
                  </div>
                ) : (
                  <button
                    onClick={startFn}
                    disabled={loading || !db}
                    className="px-8 py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold rounded-2xl text-sm shadow-sm transition-all"
                  >
                    Start Migration
                  </button>
                )}
              </div>
            </div>

            {/* Source data preview */}
            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
              <div>
                <div className="text-slate-900 font-bold text-lg">Source Data</div>
                <div className="text-slate-500 text-sm mt-1">These tables will be read and converted during the migration.</div>
              </div>
              {loading && (
                <div className="flex items-center justify-center py-10 gap-2 text-slate-400">
                  <div className="w-4 h-4 border-2 border-slate-200 border-t-blue-500 rounded-full animate-spin" />
                  Loading dataset preview…
                </div>
              )}
              {db && !loading && (
                <div className="space-y-3">
                  {Object.entries(db).map(([name, data]) => data ? <TableCard key={name} name={name} data={data} /> : null)}
                </div>
              )}
            </div>
          </div>

          {/* Right panel: pipeline stages */}
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm space-y-4 sticky top-6">
            <div>
              <div className="text-slate-900 font-bold text-lg">Pipeline Overview</div>
              <div className="text-slate-500 text-sm mt-1">5 agents execute in sequence. Each shows its inputs and outputs.</div>
            </div>
            <div className="space-y-0">
              {STAGES.map((s, idx) => (
                <div key={s.num} className="flex gap-4">
                  <div className="flex flex-col items-center">
                    <div className="w-9 h-9 rounded-full bg-blue-600 text-white font-bold flex items-center justify-center shrink-0 text-sm">{s.num}</div>
                    {idx < STAGES.length - 1 && <div className="w-0.5 flex-1 bg-slate-200 my-1.5" />}
                  </div>
                  <div className="pb-5">
                    <div className="text-slate-900 font-semibold text-sm">{s.title}</div>
                    <div className="text-slate-500 text-xs mt-1 leading-relaxed">{s.subtitle}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
