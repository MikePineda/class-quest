/**
 * The fourth door: what the run was worth, and the way out.
 *
 * The rule this screen is built around is the same one at the top of
 * `gating.ts`, stated the other way up: **it summarises, it never awards.**
 * Reaching it is a browser-side decision (three portals walked), so nothing on
 * it may be produced by that decision. Every number here was written by the
 * server —
 *
 * - XP is `AttemptOut.world_xp` / `ProgressOut.xp`, never a total added up here;
 * - mastery is `conceptTrail`'s verdict, which is built from `best_correct`, so
 *   an idea counts as learned only when every question on it was answered
 *   *correctly*: walking every scene and getting them all wrong reads as
 *   unfinished, which is the one lie a tool built to find misconceptions cannot
 *   tell;
 * - the class numbers are `GET /servers/{id}/cohort`, and the thin-data cases are
 *   refused in `cohortStats` rather than dressed up here.
 *
 * If the class request failed, the class simply is not on the screen. The run
 * still ended, and the learner's own result is not worth less because a second
 * request timed out.
 */

import type { JSX } from 'react'

import type { CohortOut } from '../../api/types'
import type { ConceptProgress } from '../pedagogy'
import type { BoardRow } from './cohortStats'
import { classSnapshot, masterySummary } from './cohortStats'
import { CohortChallenge } from './CohortChallengePanel'

export interface WorldClosurePanelProps {
  /** The world's title, for the closing line. */
  worldTitle: string
  /**
   * The concept trail, **built with its `correctSceneIds` argument**:
   * `conceptTrail(graph, gauntlet, completed, correct)`. Called with three
   * arguments it silently degrades to "every scene visited", and this screen
   * would then call an idea learned that the learner got wrong every time.
   */
  trail: readonly ConceptProgress[]
  /** World XP as the server reported it. Null means it is unknown, and it is then not shown. */
  worldXp: number | null
  /** `GET /servers/{id}/cohort`, or null while loading / when the request failed. */
  cohort: CohortOut | null
  /** The class request is still in flight, so the section can wait instead of saying "no class". */
  loadingClass?: boolean
  /** Back to the hub. */
  onClose: () => void
  /** Where "leave" goes. The servers screen by default. */
  leaveHref?: string
  /** Called instead of following `leaveHref` when the host wants to route itself. */
  onLeave?: () => void
}

export function WorldClosurePanel({
  worldTitle,
  trail,
  worldXp,
  cohort,
  loadingClass = false,
  onClose,
  leaveHref = '/',
  onLeave,
}: WorldClosurePanelProps): JSX.Element {
  const mastery = masterySummary(trail)
  // Everything that is not mastered, in one group. Splitting "started" from
  // "never opened" would be a distinction without a difference on a closing
  // screen, and leaving the untouched ones out entirely would print a count
  // ("2 of 5") with three ideas missing from underneath it.
  const open = [...mastery.practised, ...mastery.untouched]
  const snapshot = classSnapshot(cohort)

  return (
    <div>
      <p className="text-sm leading-6 text-ink-muted">
        You have read {worldTitle}, answered it and explained it back. Here is what stuck.
      </p>

      {/* What the learner actually got right. */}
      <section aria-label="What you learned" className="mt-6 rounded-xl border border-white/10 bg-background/40 p-4">
        <div className="flex items-baseline justify-between gap-3">
          <p className="eyebrow text-secondary">Learned for real</p>
          <p className="text-xs font-semibold text-ink-muted">
            <span className="text-ink">{mastery.mastered.length}</span> of {mastery.total}{' '}
            {mastery.total === 1 ? 'idea' : 'ideas'}
          </p>
        </div>

        {mastery.mastered.length === 0 ? (
          <p className="mt-3 text-sm leading-6 text-ink-muted">
            No idea is finished yet: an idea only counts here once every question on it has been answered
            correctly. Everything below is still open, and every one of them can be answered again.
          </p>
        ) : (
          <>
            <p className="mt-3 text-sm leading-6 text-ink-muted">
              Every question on these was answered right — not just visited.
            </p>
            <ul className="mt-3 flex flex-wrap gap-2">
              {mastery.mastered.map((entry) => (
                <li
                  key={entry.concept.id}
                  className="rounded-lg border border-secondary/35 bg-secondary/10 px-2.5 py-1 text-sm font-bold text-secondary"
                >
                  {entry.concept.label}
                </li>
              ))}
            </ul>
          </>
        )}

        {open.length > 0 && (
          <>
            <p className="mt-4 text-xs font-bold uppercase tracking-[0.12em] text-ink-muted">Worth another pass</p>
            <ul className="mt-2 flex flex-wrap gap-2">
              {open.map((entry) => (
                <li
                  key={entry.concept.id}
                  className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-sm font-semibold text-ink-muted"
                >
                  {entry.concept.label}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      {/* XP. The server's number or nothing at all. */}
      {worldXp !== null && (
        <p className="mt-4 flex items-baseline gap-2 text-sm text-ink-muted">
          <span className="rounded-full border border-primary/35 bg-primary/10 px-3 py-1 text-xs font-black text-primary-soft">
            {worldXp} XP
          </span>
          earned in this world.
        </p>
      )}

      {/* The class. Absent rather than invented when there is nothing to show. */}
      {snapshot ? (
        <section aria-label="Your class" className="mt-6 rounded-xl border border-white/10 bg-background/40 p-4">
          <div className="flex items-baseline justify-between gap-3">
            <p className="eyebrow">Your class</p>
            {snapshot.membersCount > 0 && (
              <p className="text-xs font-semibold text-ink-muted">
                {snapshot.membersCount === 1 ? 'Just you, so far' : `${snapshot.membersCount} people`}
              </p>
            )}
          </div>

          <p className="mt-3 text-sm leading-6 text-ink-muted">
            {snapshot.hardest ? (
              <>
                The room finds <span className="font-bold text-ink">{snapshot.hardest.label}</span> hardest —{' '}
                {snapshot.hardest.wrongPct}% of first answers on it were wrong.
              </>
            ) : (
              'Not enough of the class has played yet to say which idea the room finds hardest.'
            )}
          </p>

          {snapshot.rows.length > 0 && (
            <>
              <ol className="mt-4 space-y-1">
                {snapshot.rows.map((row) => (
                  <li key={row.userId}>
                    <BoardLine row={row} />
                  </li>
                ))}
              </ol>
              {snapshot.myRow && (
                <div className="mt-1 border-t border-white/10 pt-1">
                  <BoardLine row={snapshot.myRow} />
                </div>
              )}
              {snapshot.rankedCount > snapshot.rows.length && !snapshot.myRow && (
                <p className="mt-2 text-xs text-ink-muted">
                  Showing the top {snapshot.rows.length} of {snapshot.rankedCount}.
                </p>
              )}
              {!snapshot.rows.some((row) => row.mine) && !snapshot.myRow && (
                // `me` is null for anyone with no recorded attempt, even though
                // they are still listed. Say so instead of highlighting a guess.
                <p className="mt-2 text-xs text-ink-muted">
                  Your place appears here once one of your answers has been recorded.
                </p>
              )}
            </>
          )}
        </section>
      ) : (
        loadingClass && (
          <p className="mt-6 text-sm text-ink-muted" role="status" aria-live="polite">
            Checking in with the rest of the class…
          </p>
        )
      )}

      {cohort && <CohortChallenge cohort={cohort} />}

      <div className="mt-7 flex flex-wrap items-center gap-3">
        {onLeave ? (
          <button type="button" className="button-primary" onClick={onLeave}>
            Leave the world
          </button>
        ) : (
          <a className="button-primary" href={leaveHref}>
            Leave the world
          </a>
        )}
        <button type="button" className="button-secondary" onClick={onClose}>
          Stay and keep playing
        </button>
      </div>
    </div>
  )
}

/** One line of the board. XP is the server's; nothing here is computed. */
function BoardLine({ row }: { row: BoardRow }): JSX.Element {
  return (
    <div
      aria-current={row.mine ? 'true' : undefined}
      className={`flex items-baseline gap-3 rounded-lg px-2 py-1 ${
        row.mine ? 'bg-primary/10 ring-1 ring-inset ring-primary/30' : ''
      }`}
    >
      <span className="w-6 shrink-0 text-xs font-black tabular-nums text-ink-muted">{row.rank}</span>
      <span className={`min-w-0 flex-1 truncate text-sm font-semibold ${row.mine ? 'text-ink' : 'text-ink-muted'}`}>
        {row.name}
        {row.mine && <span className="ml-2 text-xs font-black text-primary-soft">you</span>}
      </span>
      <span className="shrink-0 text-sm font-black tabular-nums text-ink-soft">{row.xp} XP</span>
    </div>
  )
}
