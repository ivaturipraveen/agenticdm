import { useEffect, useState } from 'react'
import Login from './shell/Login'
import AppSelector from './shell/AppSelector'
import AgenticApp from './agenticdm/AgenticApp'
import LaCareApp from './lacare/LaCareApp'
import { loadSession, Session } from './shell/auth'

type AppId = 'agentic' | 'lacare'

type View =
  | { kind: 'login' }
  | { kind: 'selector' }
  | { kind: 'app'; app: AppId }

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [view, setView] = useState<View>({ kind: 'login' })

  useEffect(() => {
    const existing = loadSession()
    if (existing) {
      setSession(existing)
      setView({ kind: 'selector' })
    }
  }, [])

  if (view.kind === 'login' || !session) {
    return (
      <Login
        onAuthenticated={(s) => {
          setSession(s)
          setView({ kind: 'selector' })
        }}
      />
    )
  }

  if (view.kind === 'selector') {
    return (
      <AppSelector
        session={session}
        onSelect={(app) => setView({ kind: 'app', app })}
        onLogout={() => {
          setSession(null)
          setView({ kind: 'login' })
        }}
      />
    )
  }

  if (view.app === 'agentic') {
    return (
      <AgenticApp
        onExitToLauncher={() => setView({ kind: 'selector' })}
        userLabel={session.user.display_name}
      />
    )
  }

  return (
    <LaCareApp
      onExitToLauncher={() => setView({ kind: 'selector' })}
      userLabel={session.user.display_name}
    />
  )
}
