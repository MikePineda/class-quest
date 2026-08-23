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
import type { ServerSummary, WorldSummary } from '../api/types'
import { statusTone } from '../foundation/status'
import { WorldList } from '../foundation/WorldList'
import { BackLink } from '../nav/BackLink'
import { FIXTURE_HREF, OVERFITTING_HREF } from '../nav/routes'

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

export function WorldPicker() {
  // Bumping this re-runs the fetch. A full page reload would work too, but it
  // throws away the router's history and, on a phone, costs a cold start.
  const [attempt, setAttempt] = useState(0)
  // Keyed by the attempt it was fetched for, so a retry reads as "loading"
  // during render rather than through a setState inside the effect.
  const [fetched, setFetched] = useState<{ attempt: number; value: State } | null>(null)
  const state: State = fetched?.attempt === attempt ? fetched.value : { status: 'loading' }

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
        if (!cancelled) setFetched({ attempt, value: { status: 'ready', groups } })
      })
      .catch((error: unknown) => {
        if (!cancelled) setFetched({ attempt, value: { status: 'error', ...describe(error) } })
      })
    return () => {
      cancelled = true
    }
  }, [attempt])

  const worldCount =
    state.status === 'ready' ? state.groups.reduce((sum, group) => sum + group.worlds.length, 0) : 0

  return (
    <main className="min-h-screen bg-app-grid px-4 py-10 sm:px-6 lg:py-14">
      <div className="mx-auto w-full max-w-3xl">
        <header>
          {/* The happy path used to be the one state with no way home: if you
              had worlds, every link on the page went deeper. */}
          <BackLink to="/" className="-ml-2">Your servers</BackLink>
          <p className="eyebrow mt-3">Pick a world</p>
          <h1 className="mt-2 text-3xl font-black tracking-tight">Which world do you want to walk?</h1>
          <p className="mt-3 text-ink-muted">
            Every world that finished generating is listed here, grouped by its server.
          </p>
        </header>

        <section className="mt-8 rounded-2xl border border-primary/25 bg-surface p-5">
          <p className="eyebrow">Bundled worlds</p>
          <h2 className="mt-2 font-bold text-ink">Ship with the app, need no API</h2>
          <p className="mt-1 text-sm text-ink-muted">
            Two hand-written worlds compiled into the page. Use them if the network is not cooperating.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <a className="button-primary" href={FIXTURE_HREF}>
              Walk Python basics
            </a>
            <a className="button-secondary" href={OVERFITTING_HREF}>
              Walk Overfitting
            </a>
          </div>
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
                  <button type="button" className="button-secondary" onClick={() => setAttempt((n) => n + 1)}>
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
        <div className="mt-4">
          <WorldList worlds={group.worlds} />
        </div>
      )}
    </section>
  )
}
