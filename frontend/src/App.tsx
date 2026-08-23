import { useEffect, useState } from 'react'
import { api, ApiError, getToken, setToken } from './api/client'
import type { TokenOut, User } from './api/types'
import { DemoExperience } from './demo/DemoExperience'
import { AuthScreen } from './foundation/AuthScreen'
import { ProfileScreen } from './foundation/ProfileScreen'
import { ServerHub } from './foundation/ServerHub'
import { Brand } from './foundation/Brand'

type Screen = 'profile' | 'servers'

/** DEV ONLY — fake user for previewing screens without a backend. */
const DEV_MOCK_USER: User = {
  id: 'dev-mock-001',
  email: 'demo@classquest.app',
  display_name: 'Demo Explorer',
  role: 'student',
  industry: 'Computer Science',
  about: 'Just exploring the UI!',
  created_at: new Date().toISOString(),
}

export default function App() {
  if (window.location.pathname === '/demo') return <DemoExperience />

  // DEV ONLY: ?screen=profile or ?screen=servers to bypass auth
  const devScreen = new URLSearchParams(window.location.search).get('screen') as Screen | null
  if (devScreen === 'profile' || devScreen === 'servers') {
    return <DevPreview initialScreen={devScreen} />
  }

  return <FoundationApp />
}

/** DEV ONLY — renders screens with a mock user, no backend needed. */
function DevPreview({ initialScreen }: { initialScreen: Screen }) {
  const [user, setUser] = useState<User>(DEV_MOCK_USER)
  const [screen, setScreen] = useState<Screen>(initialScreen)

  if (screen === 'profile') {
    return <ProfileScreen user={user} onSaved={(updated) => { setUser(updated); setScreen('servers') }} onSignOut={() => { window.location.search = '' }} />
  }
  return <ServerHub user={user} onEditProfile={() => setScreen('profile')} onSignOut={() => { window.location.search = '' }} />
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
    return <main className="grid min-h-screen place-items-center bg-app-grid"><div className="text-center"><Brand /><p className="mt-5 font-hud text-[10px] tracking-[0.1em] text-secondary">RESTORING YOUR JOURNEY…</p></div></main>
  }

  if (!user) return <AuthScreen onAuthenticated={authenticated} />

  if (screen === 'profile') {
    return <ProfileScreen user={user} onSaved={(updated) => { setUser(updated); setScreen('servers') }} onSignOut={signOut} />
  }

  return <ServerHub user={user} onEditProfile={() => setScreen('profile')} onSignOut={signOut} />
}
