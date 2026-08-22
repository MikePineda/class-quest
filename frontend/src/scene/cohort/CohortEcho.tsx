/**
 * What the rest of the class answered on the question the learner just
 * committed to.
 *
 * This exists because the loneliest moment in a single-player learning tool is
 * the second after you get something wrong. Being told that eleven other people
 * picked the same wrong option turns a private failure into a shared one, which
 * is the difference between "I am bad at this" and "this is the hard part".
 *
 * Three rules hold it together:
 *
 * - **It renders only after the answer is committed.** `chosenOptionId` is the
 *   structural guard: without a committed option there is nothing to echo and
 *   the component returns null, so no wiring mistake can put the correct answer
 *   on screen before the learner has owned their guess.
 * - **It refuses thin data.** One player answering means one bar at 100%, which
 *   looks like a finding and is not. Below `MIN_ECHO_ANSWERS` the panel says how
 *   many answers exist and stops there.
 * - **It never says a wrong belief in the schema's words.** The trap is named
 *   with the misconception's own `statement`, written in the learner's voice, or
 *   with the option they read. Nothing else.
 */

import type { JSX } from 'react'

import type { CohortOut, CourseGraph } from '../../api/types'
import type { EchoOption } from './cohortStats'
import { sceneEcho } from './cohortStats'

export interface CohortEchoProps {
  /** The question that was just answered (the scene id the attempt was posted for). */
  sceneId: string
  /** `GET /servers/{id}/cohort`, or null while loading / when the request failed. */
  cohort: CohortOut | null
  /**
   * The option the learner locked in. **Null renders nothing** — this is the
   * guard that keeps the class's answers from leaking before the commit.
   */
  chosenOptionId: string | null
  /** The world's graph, used only to name the trap in the learner's own words. */
  graph?: CourseGraph | null
  /** Extra layout classes for the host panel. */
  className?: string
}

export function CohortEcho({
  sceneId,
  cohort,
  chosenOptionId,
  graph = null,
  className = '',
}: CohortEchoProps): JSX.Element | null {
  // No committed answer, no echo. See the note above: this is a guard, not a
  // convenience.
  if (!chosenOptionId) return null

  const echo = sceneEcho(cohort, sceneId, { chosenOptionId, graph })
  // Null covers every "nothing to say" case at once: no payload yet, a failed
  // request, and a question nobody has reached.
  if (!echo) return null

  return (
    <section
      aria-label="How the rest of the class answered"
      className={`rounded-xl border border-white/10 bg-background/40 p-4 ${className}`}
    >
      <div className="flex items-baseline justify-between gap-3">
        <p className="eyebrow text-secondary">The rest of the class</p>
        <p className="text-xs font-semibold text-ink-muted">
          {echo.answers === 1 ? '1 answer so far' : `${echo.answers} answers so far`}
        </p>
      </div>

      {!echo.enough ? (
        <p className="mt-3 text-sm leading-6 text-ink-muted">
          {echo.answers === 1 && echo.options.some((option) => option.mine && option.count > 0)
            ? // The single counted answer is the learner's own, so say that
              // rather than "one person" — they are the one person.
              'You are the first one here. Once more of the class has played, this is where you will see what they picked.'
            : 'Too few answers so far to show what the class picked — this fills in as more of them play.'}
        </p>
      ) : (
        <>
          <ul className="mt-3 space-y-2">
            {echo.options.map((option) => (
              <li key={option.optionId}>
                <EchoBar option={option} />
              </li>
            ))}
          </ul>

          {echo.trap && (
            <p className="mt-4 text-sm leading-6 text-ink-soft">
              <span className="font-bold text-primary-soft">
                {echo.trap.pct}% of the class went the same wrong way.
              </span>{' '}
              {echo.trap.belief ? (
                <>
                  They are thinking: <span className="italic text-ink">“{echo.trap.belief}”</span>
                </>
              ) : (
                <>
                  They picked <span className="italic text-ink">“{echo.trap.text}”</span>.
                </>
              )}
            </p>
          )}
        </>
      )}
    </section>
  )
}

/** One option's share: a labelled bar, with the numbers also written out. */
function EchoBar({ option }: { option: EchoOption }): JSX.Element {
  const tone = option.correct ? 'bg-secondary' : 'bg-primary/70'

  return (
    <div className={`rounded-lg px-2 py-1.5 ${option.mine ? 'bg-white/5 ring-1 ring-inset ring-white/15' : ''}`}>
      <div className="flex items-baseline justify-between gap-3">
        <p className={`min-w-0 flex-1 text-sm leading-6 ${option.correct ? 'text-ink' : 'text-ink-muted'}`}>
          {option.text}
        </p>
        <p className="shrink-0 text-xs font-black tabular-nums text-ink-soft">{option.pct}%</p>
      </div>
      <div className="mt-1 flex items-center gap-2">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10" aria-hidden="true">
          <div className={`h-full rounded-full ${tone}`} style={{ width: `${option.pct}%` }} />
        </div>
        {option.mine && (
          <span className="shrink-0 rounded-md bg-white/10 px-1.5 py-0.5 text-[0.6rem] font-extrabold uppercase tracking-[0.12em] text-ink-soft">
            You
          </span>
        )}
        {option.correct && (
          <span className="shrink-0 rounded-md bg-secondary/15 px-1.5 py-0.5 text-[0.6rem] font-extrabold uppercase tracking-[0.12em] text-secondary">
            Right
          </span>
        )}
      </div>
    </div>
  )
}
