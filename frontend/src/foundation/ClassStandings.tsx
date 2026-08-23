/**
 * Where the class stands, on a screen that is not a world.
 *
 * The same read-only rule as everything else under `scene/cohort`: it reports
 * and it never awards. Every number is the server's, the thin-data refusals
 * live in `classSnapshot`, and if the request failed the section is simply not
 * on the screen — a server page is not worth less because a second request
 * timed out.
 */
import type { CohortOut } from '../api/types'
import { BoardLine, classSnapshot } from '../scene/cohort'

export interface ClassStandingsProps {
  cohort: CohortOut | null
  className?: string
}

export function ClassStandings({ cohort, className = '' }: ClassStandingsProps) {
  // Which row is the reader's comes from the payload's own `me`, not from a
  // caller-supplied id: the server decides who you are.
  const snapshot = classSnapshot(cohort)
  if (!snapshot) return null

  return (
    <section aria-label="Your class" className={`cq-panel p-5 sm:p-7 ${className}`.trim()}>
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <p className="eyebrow">Your class</p>
          <h2 className="mt-1 text-xl font-black">How the room is doing</h2>
        </div>
        {snapshot.membersCount > 0 && (
          <p className="text-xs font-semibold text-ink-muted">
            {snapshot.membersCount === 1 ? 'Just you, so far' : `${snapshot.membersCount} people`}
          </p>
        )}
      </div>

      <p className="mt-4 text-sm leading-6 text-ink-muted">
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
          <ol className="mt-5 space-y-1">
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
        </>
      )}
    </section>
  )
}
