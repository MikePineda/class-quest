import { useEffect } from 'react'
import { DemoExperience } from './demo/DemoExperience'
import { AuthScreen } from './foundation/AuthScreen'
import { Brand } from './foundation/Brand'
import { ProfileScreen } from './foundation/ProfileScreen'
import { ServerHub } from './foundation/ServerHub'
import { ServerScreen } from './foundation/ServerScreen'
import { useSession } from './foundation/useSession'
import { BackLink } from './nav/BackLink'
import { navigate, useRoute } from './nav/router'
import { WorldExperience } from './scene/WorldExperience'
import { WorldPicker } from './scene/WorldPicker'

/**
 * One router, one screen per address.
 *
 * There used to be two: pathname checks here, and a `'profile' | 'servers'`
 * state inside a `FoundationApp` that had no URL at all. The screen with no
 * URL was, predictably, the one nothing could link to.
 */
export default function App() {
  const route = useRoute()
  const session = useSession()
  const { user, checking } = session

  // A learner who has not said whether they teach or study gets the setup form
  // first — but only when they asked for the front door. Yanking somebody out
  // of a link they deliberately followed is not onboarding, it is a redirect
  // that loses their place.
  const needsSetup = user !== null && !user.role && route.name === 'home'
  useEffect(() => {
    if (needsSetup) navigate('/profile', { replace: true })
  }, [needsSetup])

  // Both of these are the front door: bundled content, zero API calls, and the
  // first thing a visitor with no account clicks. Gating them would be absurd.
  if (route.name === 'demo') return <DemoExperience />
  if (route.name === 'fixture') return <WorldExperience key="fixture" bundle={route.bundle} />

  if (checking) {
    return (
      <main className="grid min-h-screen place-items-center bg-app-grid">
        {/* No way out here on purpose: it is sub-second, `.finally` always
            clears it, and there is no failure state to be stranded in. */}
        <div className="text-center">
          <Brand />
          <p className="mt-5 font-hud text-[10px] tracking-[0.1em] text-secondary">RESTORING YOUR JOURNEY…</p>
        </div>
      </main>
    )
  }

  // The gate renders in place, at whatever address was asked for, so signing
  // in lands on the thing that was wanted rather than on the front page.
  if (!user) return <AuthScreen onAuthenticated={session.authenticated} />

  switch (route.name) {
    case 'profile':
      return <ProfileScreen user={user} onSaved={(updated) => { session.setUser(updated); navigate('/') }} onSignOut={session.signOut} />
    case 'server':
      return <ServerScreen key={route.serverId} serverId={route.serverId} onSignOut={session.signOut} />
    case 'worlds':
      return <WorldPicker />
    // `key` is load-bearing, not a hint. `openPortal` and `committing` are the
    // two pieces of world state not keyed by world id, so without a remount a
    // learner who leaves world A with the quiz open arrives inside world B's
    // quiz having never seen its map. Page loads used to hide this.
    //
    // Props stay primitives for the reason in HANDOFF: anything unstable that
    // reaches `WorldCanvas` reads as "movement is broken" *and* "the world
    // never loads", and neither symptom points at the cause.
    case 'world':
      return <WorldExperience key={route.worldId} worldId={route.worldId} />
    case 'notFound':
      return <NotFound path={route.path} />
    case 'home':
    default:
      return <ServerHub user={user} onSignOut={session.signOut} />
  }
}

function NotFound({ path }: { path: string }) {
  return (
    <main className="grid min-h-screen place-items-center bg-app-grid px-4">
      <div className="max-w-md text-center">
        <Brand />
        <h1 className="mt-8 text-2xl font-black tracking-tight">Nothing lives at this address.</h1>
        <p className="mt-3 break-all text-sm text-ink-muted">{path}</p>
        <div className="mt-7 flex justify-center">
          <BackLink to="/" variant="button">Your servers</BackLink>
        </div>
      </div>
    </main>
  )
}
