/**
 * The way in. `/world` used to drop straight into the bundled fixture, so the
 * only route to a real generated world was typing `/world/<id>` by hand. This
 * lists what the signed-in learner can actually walk.
 *
 * It is a utility screen on purpose: the polished navigation lives in the
 * server hub, which somebody else owns. Everything here is either a link to a
 * world or an honest sentence about why there is none.
 *
 * The bundled fixture is offered on every state, including the failures: if the
 * API is down mid-pitch it is the one thing still guaranteed to walk.
 */

import { useEffect, useState } from 'react'
import { api, ApiError } from '../api/client'
import type { GenerationStatus, ServerSummary, WorldSummary } from '../api/types'

/** `/world` with this flag walks the fixture; bare `/world` shows this picker. */
export const FIXTURE_HREF = '/world?demo=1'

interface Group {
  server: ServerSummary
  worlds: WorldSummary[]
  /** The server list loaded but this one server's detail did not. */
  error: string | null
}

type State =
  | { status: 'loading' }
  | { status: 'ready'; groups: Group[] }
  | { status: 'error'; message: string; needsSignIn: boolean }

function describe(error: unknown): { message: string; needsSignIn: boolean } {
  if (error instanceof ApiError) {
    if (error.status === 401) {
      return { message: 'You are not signed in, so your worlds cannot be listed.', needsSignIn: true }
    }
    if (typeof error.detail === 'string') return { message: error.detail, needsSignIn: false }
    return { message: `The server rejected the request (${error.status}).`, needsSignIn: false }
  }
  return { message: 'The ClassQuest API could not be reached. Check the connection and try again.', needsSignIn: false }
}

const statusTone: Record<GenerationStatus, string> = {
  ready: 'text-secondary',
  failed: 'text-error',
  pending: 'text-primary-soft',
  processing: 'text-primary-soft',
}

export function WorldPicker() {
  const [state, setState] = useState<State>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    api
      .listServers()
      .then(async (list) => {
        // The list carries only `world_count`; the worlds themselves come with
        // the server detail, so one request per server.
        const groups = await Promise.all(
          list.servers.map(async (server): Promise<Group> => {
            try {
              const detail = await api.getServer(server.id)
              return { server, worlds: detail.worlds, error: null }
            } catch (error) {
              return { server, worlds: [], error: describe(error).message }
            }
          }),
        )
        if (!cancelled) setState({ status: 'ready', groups })
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ status: 'error', ...describe(error) })
      })
    return () => {
      cancelled = true
    }
  }, [])

  const worldCount =
    state.status === 'ready' ? state.groups.reduce((sum, group) => sum + group.worlds.length, 0) : 0

  return (
    <main className="min-h-screen bg-app-grid px-4 py-10 sm:px-6 lg:py-14">
      <div className="mx-auto w-full max-w-3xl">
        <header>
          <p className="eyebrow">Pick a world</p>
          <h1 className="mt-2 text-3xl font-black tracking-tight">Which world do you want to walk?</h1>
          <p className="mt-3 text-ink-muted">
            Every world that finished generating is listed here, grouped by its server.
          </p>
        </header>

        <section className="mt-8 rounded-2xl border border-primary/25 bg-surface p-5">
          <p className="eyebrow">Offline demo</p>
          <h2 className="mt-2 font-bold text-ink">Overfitting — bundled fixture</h2>
          <p className="mt-1 text-sm text-ink-muted">
            Ships with the app and needs no API. Use it if the network is not cooperating.
          </p>
          <a className="button-primary mt-4" href={FIXTURE_HREF}>
            Walk the demo world
          </a>
        </section>

        <section className="mt-8">
          <h2 className="text-sm font-extrabold uppercase tracking-[0.18em] text-ink-muted">Your worlds</h2>

          {state.status === 'loading' && (
            <p className="mt-4 text-sm font-semibold text-ink-muted" role="status" aria-live="polite">
              Loading your servers…
            </p>
          )}

          {state.status === 'error' && (
            <div className="mt-4 rounded-xl border border-error/25 bg-error/10 p-4" role="alert">
              <p className="text-sm text-error">{state.message}</p>
              <div className="mt-4 flex flex-wrap gap-3">
                {state.needsSignIn ? (
                  <a className="button-secondary" href="/">
                    Sign in
                  </a>
                ) : (
                  <button type="button" className="button-secondary" onClick={() => window.location.reload()}>
                    Try again
                  </button>
                )}
              </div>
            </div>
          )}

          {state.status === 'ready' && state.groups.length === 0 && (
            <p className="mt-4 text-ink-muted">
              You are not in any server yet. Create one from course material, or join your team with a code.{' '}
              <a className="font-bold text-secondary underline" href="/">
                Go to your servers
              </a>
              .
            </p>
          )}

          {state.status === 'ready' && state.groups.length > 0 && worldCount === 0 && (
            <p className="mt-4 text-ink-muted">
              Your servers have no worlds yet. Generation may still be running — the server hub shows its
              progress.{' '}
              <a className="font-bold text-secondary underline" href="/">
                Go to your servers
              </a>
              .
            </p>
          )}

          {state.status === 'ready' && (
            <div className="mt-4 space-y-6">
              {state.groups.map((group) => (
                <ServerGroup key={group.server.id} group={group} />
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  )
}

function ServerGroup({ group }: { group: Group }) {
  return (
    <section className="rounded-2xl border border-white/10 bg-surface p-5">
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-bold text-ink">{group.server.name}</h3>
        {/* A generation status is only news when it is not `ready`. Printing
            READY beside every row on a screen that lists finished worlds tells
            the learner nothing and invites them to read it as "completed". */}
        {group.server.status !== 'ready' && (
          <span className={`text-xs font-extrabold uppercase tracking-[0.12em] ${statusTone[group.server.status]}`}>
            {group.server.status}
          </span>
        )}
      </div>

      {group.error && (
        <p className="mt-3 text-sm text-error" role="alert">
          {group.error}
        </p>
      )}

      {!group.error && group.worlds.length === 0 && (
        <p className="mt-3 text-sm text-ink-muted">No worlds in this server yet.</p>
      )}

      {group.worlds.length > 0 && (
        <ul className="mt-4 space-y-2">
          {group.worlds.map((world) => (
            <li key={world.id}>
              <WorldRow world={world} />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/**
 * What the learner has actually done here, in the server's own numbers.
 *
 * `my_completion` is scenes attempted over scenes, and attempting is not
 * getting it right — so this says "walked", never "mastered". Mastery lives in
 * the world, where the answers are.
 */
function WorldProgress({ world }: { world: WorldSummary }) {
  const walked = Math.round(Math.max(0, Math.min(1, world.my_completion)) * 100)
  if (world.my_xp <= 0 && walked <= 0) {
    return <span className="text-xs font-bold text-ink-muted">Not started</span>
  }
  return (
    <span className="flex items-center gap-2 text-xs font-bold text-ink-muted">
      <span className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-white/10 sm:block">
        <span className="block h-full rounded-full bg-secondary" style={{ width: `${walked}%` }} />
      </span>
      <span>{walked}% walked</span>
      {world.my_xp > 0 && (
        <>
          <span aria-hidden="true">·</span>
          <span className="text-primary">{world.my_xp} XP</span>
        </>
      )}
    </span>
  )
}

function WorldRow({ world }: { world: WorldSummary }) {
  // A world that is still generating has no progress to report, so there the
  // generation status is the only thing worth saying.
  const badge =
    world.status === 'ready' ? (
      <WorldProgress world={world} />
    ) : (
      <span className={`text-xs font-extrabold uppercase tracking-[0.12em] ${statusTone[world.status]}`}>
        {world.status}
      </span>
    )
  const title = (
    <span className="text-sm font-bold text-ink">
      {world.idx + 1}. {world.title}
    </span>
  )

  // Only a ready world has a quest to lay out, so only a ready world is a link.
  if (world.status !== 'ready') {
    return (
      <div className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-surface-high/50 px-4 py-3 opacity-60">
        {title}
        {badge}
      </div>
    )
  }

  return (
    <a
      className="flex items-center justify-between gap-3 rounded-xl border border-white/12 bg-surface-high px-4 py-3 transition hover:border-secondary/50 hover:bg-surface-highest focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      href={`/world/${encodeURIComponent(world.id)}`}
    >
      {title}
      {badge}
    </a>
  )
}
