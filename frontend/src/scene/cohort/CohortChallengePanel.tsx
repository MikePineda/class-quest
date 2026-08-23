import type { JSX } from 'react'
import { useState } from 'react'

import type { CohortOut } from '../../api/types'
import { challengeHasEnoughEvidence, selectCohortChallenge } from './challenge'

export interface CohortChallengeProps {
  cohort: CohortOut | null
}

/**
 * A lightweight, asynchronous multiplayer moment. It is deliberately local:
 * answering here does not award XP, mutate a leaderboard, or pretend to be
 * real-time PvP. Everyone contributes through the normal quiz, then can use
 * this shared evidence to recover the idea the cohort found hardest.
 */
export function CohortChallenge({ cohort }: CohortChallengeProps): JSX.Element {
  const challenge = selectCohortChallenge(cohort)
  const [selection, setSelection] = useState<{ sceneId: string | null; optionId: string | null }>({
    sceneId: null,
    optionId: null,
  })
  const selected = selection.sceneId === challenge?.sceneId ? selection.optionId : null

  if (!challenge || !challengeHasEnoughEvidence(challenge)) {
    return (
      <section aria-label="Cohort challenge" className="mt-6 rounded-xl border border-primary/25 bg-primary/5 p-4">
        <p className="eyebrow text-primary-soft">Cohort challenge</p>
        <p className="mt-2 text-sm leading-6 text-ink-muted">
          The challenge unlocks once enough classmates answer the same idea and a clear pattern emerges.
        </p>
      </section>
    )
  }

  const isCorrect = selected === challenge.correctOption.option_id

  return (
    <section aria-label="Cohort challenge" className="mt-6 rounded-xl border border-primary/30 bg-primary/5 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <p className="eyebrow text-primary-soft">Cohort challenge</p>
          <h3 className="mt-1 text-lg font-black text-ink">Recover the class idea</h3>
        </div>
        <p className="text-xs font-semibold text-ink-muted">{challenge.answers} classmates answered</p>
      </div>
      <p className="mt-3 text-sm leading-6 text-ink-muted">
        Choose the answer you would defend. This practice round is not graded; it turns the cohort’s hardest
        pattern into a quick recovery moment.
      </p>

      <div className="mt-4 grid gap-2">
        {challenge.options.map((option) => {
          const committed = selected !== null
          const correct = option.option_id === challenge.correctOption.option_id
          const wrongMajority = option.option_id === challenge.majorityWrong.option_id
          return (
            <button
              key={option.option_id}
              type="button"
              className={`rounded-lg border px-3 py-3 text-left text-sm font-semibold transition ${
                selected === option.option_id
                  ? correct
                    ? 'border-secondary bg-secondary/15 text-ink'
                    : 'border-primary bg-primary/15 text-ink'
                  : 'border-white/10 bg-white/5 text-ink-muted hover:border-primary/50 hover:text-ink'
              }`}
              aria-pressed={selected === option.option_id}
              onClick={() => setSelection({ sceneId: challenge.sceneId, optionId: option.option_id })}
            >
              <span className="block">{option.text}</span>
              {committed && (
                <span className="mt-1 block text-xs font-bold text-ink-muted">
                  {correct ? 'Correct answer' : wrongMajority ? 'Most common class choice' : 'Another class choice'}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {selected !== null && (
        <p className="mt-4 text-sm leading-6 text-ink" role="status" aria-live="polite">
          {isCorrect
            ? 'Recovered. The class pattern is useful evidence, not a verdict about any individual learner.'
            : `Good recovery attempt. The correct answer is “${challenge.correctOption.text}”.`}
        </p>
      )}
    </section>
  )
}
