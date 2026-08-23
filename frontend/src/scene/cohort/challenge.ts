import type { CohortOut, DistributionOption } from '../../api/types'
import { MIN_ECHO_ANSWERS, sceneEcho } from './cohortStats'

/** A read-only practice prompt built from the strongest measured class pattern. */
export interface CohortChallenge {
  sceneId: string
  conceptId: string
  answers: number
  options: DistributionOption[]
  majorityWrong: DistributionOption
  correctOption: DistributionOption
}

/**
 * Select one challenge deterministically. We require a real class signal and a
 * strict wrong-answer winner; otherwise the UI would turn sparse or tied data
 * into a made-up "class misconception".
 */
export function selectCohortChallenge(cohort: CohortOut | null | undefined): CohortChallenge | null {
  const candidates = (cohort?.distribution ?? [])
    .map((entry) => {
      const echo = sceneEcho(cohort, entry.scene_id)
      if (!echo?.enough || !echo.trap) return null
      const options = entry.options.filter((option) => option.count > 0 || option.correct)
      const majorityWrong = options.find((option) => option.option_id === echo.trap?.optionId)
      const correctOption = options.find((option) => option.correct)
      if (!majorityWrong || !correctOption) return null
      return {
        sceneId: entry.scene_id,
        conceptId: entry.concept_id,
        answers: echo.answers,
        options,
        majorityWrong,
        correctOption,
      }
    })
    .filter((candidate): candidate is CohortChallenge => candidate !== null)

  candidates.sort((a, b) => {
    const wrongPct = (b.majorityWrong.count / b.answers) - (a.majorityWrong.count / a.answers)
    return wrongPct || b.answers - a.answers || a.sceneId.localeCompare(b.sceneId)
  })

  return candidates[0] ?? null
}

export function challengeHasEnoughEvidence(challenge: CohortChallenge | null): boolean {
  return Boolean(challenge && challenge.answers >= MIN_ECHO_ANSWERS)
}
