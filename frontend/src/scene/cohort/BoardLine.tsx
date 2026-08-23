/**
 * One line of the board. XP is the server's; nothing here is computed.
 *
 * Lifted out of `WorldClosurePanel` when the server screen started showing the
 * same standings: two copies of "which row is mine" would drift, and the
 * highlight is the only part a learner reads carefully.
 */
import type { JSX } from 'react'

import type { BoardRow } from './cohortStats'

export function BoardLine({ row }: { row: BoardRow }): JSX.Element {
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
