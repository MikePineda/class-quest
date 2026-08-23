/**
 * The list of worlds inside one server.
 *
 * Lifted verbatim out of `scene/WorldPicker.tsx` when the server screen
 * arrived: both screens list the same rows, and two copies of "is this world
 * walkable yet" would drift. The picker still renders it, once per server.
 *
 * Nothing here computes progress. The numbers are the server's.
 */
import type { WorldSummary } from '../api/types'
import { statusTone } from './status'

/**
 * What the learner has actually done here, in the server's own numbers.
 *
 * `my_completion` is scenes attempted over scenes, and attempting is not
 * getting it right — so this says "walked", never "mastered". Mastery lives in
 * the world, where the answers are.
 */
export function WorldProgress({ world }: { world: WorldSummary }) {
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

export function WorldRow({ world }: { world: WorldSummary }) {
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
      className="flex min-h-14 items-center justify-between gap-3 rounded-xl border border-white/12 bg-surface-high px-4 py-3 transition hover:border-secondary/50 hover:bg-surface-highest focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      href={`/world/${encodeURIComponent(world.id)}`}
    >
      {title}
      {badge}
    </a>
  )
}

export function WorldList({ worlds }: { worlds: readonly WorldSummary[] }) {
  if (worlds.length === 0) return null
  return (
    <ul className="space-y-2">
      {worlds.map((world) => (
        <li key={world.id}>
          <WorldRow world={world} />
        </li>
      ))}
    </ul>
  )
}
