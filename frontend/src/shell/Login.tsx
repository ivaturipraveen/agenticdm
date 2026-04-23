import { FormEvent, useState } from 'react'
import { login, signup, Session } from './auth'

interface LoginProps {
  onAuthenticated: (session: Session) => void
}

type Mode = 'login' | 'signup'

export default function Login({ onAuthenticated }: LoginProps) {
  const [mode, setMode] = useState<Mode>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const session = mode === 'login'
        ? await login(username, password)
        : await signup({ username, password, display_name: displayName || undefined, email: email || undefined })
      onAuthenticated(session)
    } catch (err: any) {
      setError(err?.response?.data?.detail || (mode === 'login' ? 'Login failed' : 'Signup failed'))
    } finally {
      setLoading(false)
    }
  }

  const useAdmin = () => {
    setMode('login')
    setUsername('admin')
    setPassword('brightcone2026')
  }

  return (
    <div className="min-h-screen flex bg-white text-slate-900">
      <div className="hidden lg:flex flex-col justify-between w-[520px] p-12 border-r border-slate-200 bg-slate-50">
        <div>
          <img src="/unnamed.webp" alt="Brightcone" className="h-10 w-auto object-contain mb-10" />
          <h1 className="text-4xl font-semibold leading-tight text-slate-900">
            Agentic intelligence for healthcare data
          </h1>
          <p className="mt-6 text-slate-600 text-[15px] leading-relaxed">
            One platform, two modes. Run autonomous FHIR migrations or recover HEDIS
            quality evidence from millions of clinical documents — all from the same
            workbench.
          </p>
        </div>
        <div className="space-y-4 text-sm text-slate-600">
          <div className="flex items-start gap-3">
            <span className="mt-1 h-2 w-2 rounded-full bg-blue-500" />
            <p><span className="text-slate-900 font-semibold">Agentic DM</span> — Discovery → Transform → Validate → FHIR Load</p>
          </div>
          <div className="flex items-start gap-3">
            <span className="mt-1 h-2 w-2 rounded-full bg-rose-500" />
            <p><span className="text-slate-900 font-semibold">LA Care — CCDA Intelligence</span> — C-CDA parsing, narrative NLP, HEDIS measure matching</p>
          </div>
          <div className="pt-4 border-t border-slate-200 text-xs font-mono text-slate-400">
            v4.2 · Brightcone Platform · Postgres-backed
          </div>
        </div>
      </div>

      <div className="flex-1 flex flex-col justify-center items-center px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="lg:hidden mb-8 text-center">
            <img src="/unnamed.webp" alt="Brightcone" className="h-8 w-auto mx-auto" />
          </div>

          <div className="flex items-center gap-1 mb-6 p-1 rounded-lg bg-slate-100 border border-slate-200 text-sm">
            <button
              type="button"
              onClick={() => setMode('login')}
              className={`flex-1 py-2 rounded-md transition-colors ${mode === 'login' ? 'bg-white text-slate-900 shadow-sm border border-slate-200' : 'text-slate-500 hover:text-slate-800'}`}
            >
              Sign in
            </button>
            <button
              type="button"
              onClick={() => setMode('signup')}
              className={`flex-1 py-2 rounded-md transition-colors ${mode === 'signup' ? 'bg-white text-slate-900 shadow-sm border border-slate-200' : 'text-slate-500 hover:text-slate-800'}`}
            >
              Create account
            </button>
          </div>

          <h2 className="text-2xl font-semibold mb-1 text-slate-900">
            {mode === 'login' ? 'Welcome back' : 'Create your account'}
          </h2>
          <p className="text-slate-500 text-sm mb-6">
            {mode === 'login'
              ? 'Sign in with your Brightcone credentials'
              : 'Accounts are stored securely in Postgres (PBKDF2-hashed)'}
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <Field label="Username" value={username} onChange={setUsername} autoComplete="username" required />
            {mode === 'signup' && (
              <>
                <Field label="Display name" value={displayName} onChange={setDisplayName} autoComplete="name" />
                <Field label="Email (optional)" value={email} onChange={setEmail} autoComplete="email" type="email" />
              </>
            )}
            <Field label="Password" value={password} onChange={setPassword}
                   autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                   type="password" required />

            {error && (
              <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white font-semibold text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading
                ? (mode === 'login' ? 'Signing in…' : 'Creating account…')
                : (mode === 'login' ? 'Sign in' : 'Create account')}
            </button>
          </form>

          {mode === 'login' && (
            <div className="mt-6 pt-6 border-t border-slate-200 text-xs text-slate-500 space-y-2">
              <p>First-time setup? The platform is seeded with a default admin account.</p>
              <button
                onClick={useAdmin}
                type="button"
                className="underline text-slate-700 hover:text-slate-900 font-medium"
              >
                Use admin / brightcone2026
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function Field({ label, value, onChange, type = 'text', autoComplete, required }: {
  label: string
  value: string
  onChange: (v: string) => void
  type?: string
  autoComplete?: string
  required?: boolean
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-600 mb-1.5">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-4 py-2.5 bg-white border border-slate-300 rounded-lg text-sm focus:border-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900 text-slate-900 placeholder-slate-400"
        autoComplete={autoComplete}
        required={required}
      />
    </div>
  )
}
