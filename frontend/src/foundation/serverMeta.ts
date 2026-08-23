/**
 * The one-line description under a server's name on the hub.
 *
 * Every segment is a field `GET /servers` actually sends. The design this row
 * follows also carried "last opened today" — `ServerSummary` has no
 * last-opened timestamp, and `created_at` is when the server was *made*, not
 * when the learner was last inside it, so no recency claim is made here.
 * Guessing at recency in front of a class is worse than staying quiet.
 *
 * Pure and string-only: the hub renders the separators, so a test can assert
 * the wording without a DOM.
 */
import type { ServerSummary } from '../api/types'

/** Counts arrive from the wire, so they are floored and clamped before display. */
function count(value: number, noun: string): string {
  const whole = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0
  return `${whole} ${noun}${whole === 1 ? '' : 's'}`
}

export function serverMeta(server: ServerSummary): string[] {
  const segments = [server.is_public ? 'Shared' : 'Private']
  // `my_role` is `'member'` for most rows and null only on a public listing the
  // hub never renders; saying "Member" on every card would be noise.
  if (server.my_role === 'owner') segments.push('Owner')
  segments.push(count(server.member_count, 'member'))

  // `world_count` is 0 until the planner has split the upload (CONTRACTS.md),
  // so "0 worlds" mid-generation would report an outcome that has not happened.
  const unplanned = server.world_count <= 0 && (server.status === 'pending' || server.status === 'processing')
  segments.push(unplanned ? 'worlds not planned yet' : count(server.world_count, 'world'))
  return segments
}
