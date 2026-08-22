import { api } from './client'
import type { ServerDetail } from './types'

export interface PollOptions {
  /** Default 2000 ms. */
  intervalMs?: number
  /** Called once after 5 consecutive failed requests; polling stops. */
  onError?: (err: unknown) => void
}

const MAX_CONSECUTIVE_FAILURES = 5

/**
 * Poll `GET /servers/{id}` until generation finishes (`ready` | `failed`).
 * Transient errors are swallowed and retried on the next tick.
 * Returns a cancel function; call it on unmount.
 */
export function pollServer(id: string, onTick: (s: ServerDetail) => void, opts: PollOptions = {}): () => void {
  const interval = opts.intervalMs ?? 2000
  let cancelled = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let failures = 0

  const tick = async () => {
    if (cancelled) return
    try {
      const s = await api.getServer(id)
      if (cancelled) return
      failures = 0
      onTick(s)
      if (s.status === 'ready' || s.status === 'failed') return
    } catch (err) {
      if (cancelled) return
      failures += 1
      if (failures >= MAX_CONSECUTIVE_FAILURES) {
        cancelled = true
        opts.onError?.(err)
        return
      }
    }
    timer = setTimeout(tick, interval)
  }

  void tick()
  return () => {
    cancelled = true
    if (timer !== undefined) clearTimeout(timer)
  }
}
