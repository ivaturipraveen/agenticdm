import { useEffect, useState } from 'react'
import { AppCatalogEntry, fetchAppCatalog, Session, logout, clearSession } from './auth'

interface Props {
  session: Session
  onSelect: (appId: 'agentic' | 'lacare') => void
  onLogout: () => void
}

const ICONS: Record<string, JSX.Element> = {
  flow: (
    <svg className="w-7 h-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="5" cy="6" r="2" /><circle cx="5" cy="18" r="2" /><circle cx="19" cy="12" r="2" />
      <path d="M7 6h5l3 6-3 6H7" />
    </svg>
  ),
  health: (
    <svg className="w-7 h-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 21s-7-4.5-7-10a5 5 0 0 1 9-3 5 5 0 0 1 9 3c0 5.5-7 10-7 10-.7.4-3.3.4-4 0Z" />
    </svg>
  ),
}

export default function AppSelector({ session, onSelect, onLogout }: Props) {
  const [apps, setApps] = useState<AppCatalogEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchAppCatalog()
      .then(setApps)
      .catch(() => setApps([]))
      .finally(() => setLoading(false))
  }, [])

  const doLogout = async () => {
    await logout(session.token)
    clearSession()
    onLogout()
  }

  const availableApps = apps.filter(a => session.user.apps.includes(a.id))

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <header className="flex items-center justify-between px-8 py-5 bg-white border-b border-slate-200">
        <div className="flex items-center gap-3">
          <img src="/unnamed.webp" alt="Brightcone" className="h-9 w-auto object-contain" />
          <div className="hidden sm:block border-l border-slate-200 pl-3 text-slate-500 text-sm font-medium">
            Platform Workbench
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <div className="text-sm font-semibold text-slate-800">{session.user.display_name}</div>
            <div className="text-xs text-slate-500 capitalize">{session.user.role}</div>
          </div>
          <div className="h-10 w-10 rounded-full bg-gradient-to-br from-blue-500 to-blue-600 text-white flex items-center justify-center font-semibold text-sm">
            {session.user.display_name.split(' ').map(s => s[0]).slice(0, 2).join('')}
          </div>
          <button onClick={doLogout} className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100 font-medium">
            Sign out
          </button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-8 py-16">
        <div className="mb-12">
          <h1 className="text-3xl font-semibold text-slate-900">Choose a workspace</h1>
          <p className="text-slate-500 mt-2">Each workspace is an independent application with its own dashboard, pipelines, and data.</p>
        </div>

        {loading ? (
          <div className="text-slate-500">Loading workspaces…</div>
        ) : (
          <div className="grid md:grid-cols-2 gap-6">
            {availableApps.map(app => (
              <button
                key={app.id}
                onClick={() => onSelect(app.id)}
                className={`group relative text-left p-8 rounded-2xl bg-white border border-slate-200 hover:border-${app.accent}-400 hover:shadow-xl transition-all overflow-hidden`}
              >
                <div className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${app.accent === 'rose' ? 'from-rose-400 via-pink-500 to-rose-600' : 'from-blue-400 via-blue-500 to-indigo-600'}`} />
                <div className="flex items-start justify-between">
                  <div className={`h-14 w-14 rounded-2xl flex items-center justify-center ${app.accent === 'rose' ? 'bg-rose-50 text-rose-600' : 'bg-blue-50 text-blue-600'}`}>
                    {ICONS[app.icon] ?? ICONS.flow}
                  </div>
                  <span className={`text-[10px] font-bold tracking-widest uppercase ${app.accent === 'rose' ? 'text-rose-600' : 'text-blue-600'}`}>
                    {app.accent === 'rose' ? 'LA Care Health Plan' : 'Brightcone'}
                  </span>
                </div>
                <h3 className="mt-6 text-xl font-semibold text-slate-900 group-hover:text-slate-950">{app.name}</h3>
                <p className={`text-sm font-medium mt-1 ${app.accent === 'rose' ? 'text-rose-600' : 'text-blue-600'}`}>{app.tagline}</p>
                <p className="text-sm text-slate-600 mt-4 leading-relaxed">{app.description}</p>

                <div className={`mt-8 inline-flex items-center gap-2 text-sm font-semibold ${app.accent === 'rose' ? 'text-rose-600' : 'text-blue-600'} group-hover:gap-3 transition-all`}>
                  Open workspace
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 12h14M13 5l7 7-7 7" />
                  </svg>
                </div>
              </button>
            ))}
          </div>
        )}

        {!loading && availableApps.length === 0 && (
          <div className="text-center py-24 text-slate-500">
            No workspaces available for this account.
          </div>
        )}
      </main>
    </div>
  )
}
