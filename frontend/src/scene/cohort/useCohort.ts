/**
 * One best-effort read of `GET /servers/{id}/cohort`, shared by everything that
 * wants to know what the class did.
 *
 * Two properties matter more than anything this hook returns.
 *
 * **It never breaks the world.** A failure — offline, 403 from a server the
 * learner is not in, a fixture world with no server at all — leaves `cohort` at
 * null and says nothing, exactly like the best-effort `api.getProgress` call in
 * `WorldExperience`. Every consumer already has to handle null, because null is
 * also what "still loading" and "nobody has answered yet" look like.
 *
 * **It does not poll.** That endpoint runs one aggregate query per member and
 * one first-attempt scan per prediction scene per ready world. It is fine at
 * demo scale and trivially abusable, so: one request per server id, shared
 * across every component that asks for it, reused from a module-level cache for
 * `CACHE_MS`, and no interval timer anywhere. `refresh()` is the only way to ask
 * again, and inside the cache window it is a no-op by design — the same window
 * is the rate limit.
 *
 * The state kept in React is deliberately only a redraw counter: the snapshot
 * itself lives in the module cache and is read during render, so two panels
 * open at once cannot hold two different versions of the same class.
 */

import { useCallback, useEffect, useState } from 'react'

import { api } from '../../api/client'
import type { CohortOut } from '../../api/types'

/** How long a snapshot is reused before another request is allowed. */
export const CACHE_MS = 30_000

interface Entry {
  at: number
  value: CohortOut
}

/**
 * Module-level, so two panels open in one session make one request, and closing
 * and reopening a portal makes none. Cleared only by a page load, which is the
 * right lifetime for a demo.
 */
const cache = new Map<string, Entry>()
/** Server ids whose last read failed, so a null stops reading as "still loading". */
const failed = new Set<string>()
const inFlight = new Map<string, Promise<CohortOut | null>>()

/** Shared fetch: concurrent callers for one server id await the same promise. */
function load(serverId: string): Promise<CohortOut | null> {
  const pending = inFlight.get(serverId)
  if (pending) return pending

  const request = api
    .cohort(serverId)
    .then((value) => {
      cache.set(serverId, { at: Date.now(), value })
      failed.delete(serverId)
      return value
    })
    .catch(() => {
      // Deliberately silent. The class is a garnish; the world is the meal.
      failed.add(serverId)
      return null
    })
    .finally(() => {
      inFlight.delete(serverId)
    })

  inFlight.set(serverId, request)
  return request
}

export interface CohortState {
  /** Null while loading, when the request failed, and when there is no server. */
  cohort: CohortOut | null
  /** A first read is still on its way. False once it has failed — a failure is an answer. */
  loading: boolean
  /**
   * Ask for a newer snapshot. A no-op inside the cache window, so calling it on
   * every answer cannot turn into a poll.
   */
  refresh: () => void
}

/**
 * @param serverId `WorldDetail.server_id`. Null/undefined (the fixture world,
 *   or a world that has not loaded) means no request is made at all.
 * @param options.enabled Set false to hold the request back until the data is
 *   actually about to be shown. Defaults to true.
 */
export function useCohort(
  serverId: string | null | undefined,
  options?: { enabled?: boolean },
): CohortState {
  const enabled = options?.enabled ?? true
  const [nonce, setNonce] = useState(0)
  // Only a redraw signal: the snapshot itself is read from the cache below.
  const [, setTick] = useState(0)

  useEffect(() => {
    if (!serverId || !enabled) return
    const entry = cache.get(serverId)
    if (entry && Date.now() - entry.at < CACHE_MS) return

    let cancelled = false
    load(serverId).then(() => {
      if (!cancelled) setTick((current) => current + 1)
    })

    return () => {
      cancelled = true
    }
  }, [serverId, enabled, nonce])

  const refresh = useCallback(() => {
    setNonce((current) => current + 1)
  }, [])

  const cohort = serverId ? (cache.get(serverId)?.value ?? null) : null
  const loading = Boolean(serverId) && enabled && cohort === null && !failed.has(serverId ?? '')
  return { cohort, loading, refresh }
}
