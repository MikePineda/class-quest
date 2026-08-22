import { useEffect, useState } from 'react'
import { api, ApiError, getToken, setToken } from './api/client'
import type { TokenOut, User } from './api/types'
import { DemoExperience } from './demo/DemoExperience'
import { AuthScreen } from './foundation/AuthScreen'
import { ProfileScreen } from './foundation/ProfileScreen'
import { ServerHub } from './foundation/ServerHub'
import { WorldExperience } from './scene/WorldExperience'

type Screen = 'profile' | 'servers'

export default function App() {
  if (window.location.pathname === '/demo') return <DemoExperience />

  // `/world/<id>` walks a real generated world; bare `/world` walks the fixture.
  const world = window.location.pathname.match(/^\/world(?:\/([^/]+))?\/?$/)
  if (world) return <WorldExperience worldId={world[1] ? decodeURIComponent(world[1]) : undefined} />

  return <FoundationApp />
}

function FoundationApp() {
  const [user, setUser] = useState<User | null>(null)
  const [screen, setScreen] = useState<Screen>('servers')
  const [checkingSession, setCheckingSession] = useState(() => getToken() !== null)

  useEffect(() => {
    if (!getToken()) return
    api.me()
      .then((currentUser) => {
        setUser(currentUser)
        setScreen(currentUser.role ? 'servers' : 'profile')
      })
      .catch((error: unknown) => {
        if (error instanceof ApiError && error.status === 401) setToken(null)
      })
      .finally(() => setCheckingSession(false))
  }, [])

  const authenticated = (session: TokenOut) => {
    setToken(session.token)
    setUser(session.user)
    setScreen(session.user.role ? 'servers' : 'profile')
  }

  const signOut = () => {
    setToken(null)
    setUser(null)
    setScreen('servers')
  }

  if (checkingSession) {
    return <main className="grid min-h-screen place-items-center bg-app-grid"><div className="text-center"><span className="mx-auto grid h-12 w-12 place-items-center rounded-xl bg-primary font-black text-background">CQ</span><p className="mt-4 text-sm font-semibold text-ink-muted">Restoring your session…</p></div></main>
  }

  if (!user) return <AuthScreen onAuthenticated={authenticated} />

  if (screen === 'profile') {
    return <ProfileScreen user={user} onSaved={(updated) => { setUser(updated); setScreen('servers') }} onSignOut={signOut} />
  }

  return <ServerHub user={user} onEditProfile={() => setScreen('profile')} onSignOut={signOut} />
}
