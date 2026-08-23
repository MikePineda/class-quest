/**
 * One server: its worlds, its invite code, how far its generation got, and
 * where the class stands.
 *
 * This screen is why clicking a server card used to be a lie. The card linked
 * to a hardcoded `/world`, so every server on the hub opened the same
 * cross-server list of every world the learner could reach. Picking one thing
 * has to open that thing.
 */
import { useEffect, useState } from 'react'
import { api, ApiError } from '../api/client'
import { pollServer } from '../api/poll'
import type { CohortOut, ServerDetail } from '../api/types'
import { useCohort } from '../scene/cohort'
import { BackLink } from '../nav/BackLink'
import { Brand } from './Brand'
import { readableError } from './errors'
import { ClassStandings } from './ClassStandings'
import { WorldList } from './WorldList'

type Trouble = 'signin' | 'forbidden' | 'missing' | 'transient'

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string; kind: Trouble }
  // Generation status is a field of the server, not a state of the screen:
  // keeping it inside `ready` means the way out is written once.
  | { status: 'ready'; detail: ServerDetail }

function describe(error: unknown): { message: string; kind: Trouble } {
  if (error instanceof ApiError) {
    if (error.status === 401) {
      return { message: 'You are not signed in, so this server cannot be loaded.', kind: 'signin' }
    }
    if (error.status === 403) {
      return { message: 'This server belongs to a class you have not joined.', kind: 'forbidden' }
    }
    if (error.status === 404) {
      return { message: 'No server with that address. It may have been deleted.', kind: 'missing' }
    }
  }
  return { message: readableError(error), kind: 'transient' }
}

export interface ServerScreenProps {
  serverId: string
  onSignOut: () => void
}

export function ServerScreen({ serverId, onSignOut }: ServerScreenProps) {
  const [attempt, setAttempt] = useState(0)
  // Keyed by the attempt it was fetched for, so a retry reads as "loading"
  // during render instead of through a setState inside the effect.
  const [fetched, setFetched] = useState<{ attempt: number; value: State } | null>(null)
  const state: State = fetched?.attempt === attempt ? fetched.value : { status: 'loading' }
  const { cohort } = useCohort(state.status === 'ready' ? serverId : null)

  useEffect(() => {
    let cancelled = false
    let stopPolling: (() => void) | null = null

    // One plain request first, then hand off to the poller. `pollServer`
    // swallows five consecutive failures before it reports anything, so using
    // it for the opening fetch would sit on "Loading…" for ten seconds and
    // then call a 403 a connection problem.
    api
      .getServer(serverId)
      .then((detail) => {
        if (cancelled) return
        setFetched({ attempt, value: { status: 'ready', detail } })
        if (detail.status === 'ready' || detail.status === 'failed') return
        stopPolling = pollServer(serverId, (tick) => {
          if (!cancelled) setFetched({ attempt, value: { status: 'ready', detail: tick } })
        })
      })
      .catch((error: unknown) => {
        if (!cancelled) setFetched({ attempt, value: { status: 'error', ...describe(error) } })
      })

    return () => {
      cancelled = true
      stopPolling?.()
    }
  }, [serverId, attempt])

  return (
    <div className="min-h-screen bg-app-grid">
      <header className="border-b border-white/10 bg-background-raised/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
          <Brand compact subtitle="Server" />
          <div className="flex items-center gap-2">
            <BackLink to="/">Your servers</BackLink>
            <button
              type="button"
              className="rounded-lg border border-white/10 px-3 py-2 text-sm font-bold text-ink-muted hover:border-white/25 hover:text-ink"
              onClick={onSignOut}
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8 lg:py-12">
        {state.status === 'loading' && (
          <p className="text-sm font-semibold text-ink-muted" role="status" aria-live="polite">
            Loading this server…
          </p>
        )}

        {state.status === 'error' && (
          <div className="rounded-2xl border border-error/25 bg-error/8 p-6" role="alert">
            <p className="text-ink">{state.message}</p>
            <div className="mt-5 flex flex-wrap gap-3">
              {state.kind === 'transient' && (
                <button type="button" className="button-primary" onClick={() => setAttempt((n) => n + 1)}>
                  Try again
                </button>
              )}
              <BackLink to="/" variant="button">
                {state.kind === 'signin' ? 'Sign in' : 'Your servers'}
              </BackLink>
            </div>
          </div>
        )}

        {state.status === 'ready' && (
          <ServerBody detail={state.detail} cohort={cohort} />
        )}
      </main>
    </div>
  )
}

function ServerBody({
  detail,
  cohort,
}: {
  detail: ServerDetail
  cohort: CohortOut | null
}) {
  const ready = detail.worlds.filter((world) => world.status === 'ready')
  return (
    <>
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="eyebrow">{detail.member_count} member{detail.member_count === 1 ? '' : 's'} · {detail.pet} guide</p>
          <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">{detail.name}</h1>
          {detail.description && <p className="mt-3 max-w-2xl text-ink-muted">{detail.description}</p>}
        </div>
        {/* `join_code` is omitted for a non-member on a public server, so this
            is conditional on the field, not on the string being non-empty. */}
        {detail.join_code != null && (
          <div className="rounded-xl border border-secondary/25 bg-secondary/8 px-4 py-3">
            <p className="text-xs font-bold text-ink-muted">Invite code</p>
            <strong className="font-hud text-base tracking-[0.14em] text-primary">{detail.join_code}</strong>
          </div>
        )}
      </div>

      {detail.error && (
        <p className="mt-6 rounded-xl border border-error/25 bg-error/8 p-4 text-sm text-error" role="alert">
          {detail.error}
        </p>
      )}

      {detail.status !== 'ready' && <GenerationProgress detail={detail} />}

      <section className="mt-8 cq-panel p-5 sm:p-7">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="eyebrow">Worlds</p>
            <h2 className="mt-1 text-xl font-black">
              {ready.length > 0 ? 'Pick one and walk it' : 'Nothing walkable yet'}
            </h2>
          </div>
          <span className="rounded-full bg-surface-high px-3 py-1 text-sm font-bold text-ink-muted">
            {detail.worlds.length}
          </span>
        </div>
        <div className="mt-6">
          {detail.worlds.length === 0 ? (
            <p className="text-sm leading-6 text-ink-muted">
              {detail.status === 'ready'
                ? 'This server finished without producing a world. Nothing here can be walked.'
                : 'The material is still being turned into worlds. They will appear here as they finish.'}
            </p>
          ) : (
            <WorldList worlds={detail.worlds} />
          )}
        </div>
      </section>

      <ClassStandings cohort={cohort} className="mt-8" />
    </>
  )
}

/**
 * What the pipeline is doing. `ServerDetail.progress` has been on the wire
 * since the API was written and this is the first screen to render it — before
 * now, a server that was still generating just looked empty.
 */
function GenerationProgress({ detail }: { detail: ServerDetail }) {
  const { progress } = detail
  const failed = detail.status === 'failed'
  return (
    <section className="mt-8 rounded-2xl border border-white/10 bg-surface p-5" aria-live="polite">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <p className="eyebrow">{failed ? 'Generation stopped' : 'Building your worlds'}</p>
        <p className="text-sm font-bold text-ink-muted">
          {progress.worlds_ready} of {progress.worlds_total} ready
          {progress.worlds_failed > 0 && ` · ${progress.worlds_failed} failed`}
        </p>
      </div>
      <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/10">
        <div
          className={`h-full rounded-full transition-[width] duration-500 ${failed ? 'bg-error' : 'bg-secondary'}`}
          style={{ width: `${Math.max(0, Math.min(100, progress.percent))}%` }}
        />
      </div>
      {progress.log.length > 0 && (
        <ul className="mt-4 space-y-1">
          {progress.log.slice(-4).map((event) => (
            <li key={`${event.ts}-${event.stage}`} className="text-xs text-ink-muted">
              <span className="font-hud text-[10px] tracking-[0.08em] text-ink-soft">{event.stage}</span>{' '}
              {event.message}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
