import type { CohortOut, SceneDistribution } from '../api/types'

export type CohortReadiness = 'unavailable' | 'waiting' | 'ready'

export const MIN_COHORT_ANSWERS = 3

function hasClearPattern(entry: SceneDistribution): boolean {
  const answers = entry.options.reduce((total, option) => total + Math.max(0, Math.floor(option.count)), 0)
  if (answers < MIN_COHORT_ANSWERS) return false

  const wrong = entry.options
    .filter((option) => !option.correct && option.count > 0)
    .sort((a, b) => b.count - a.count)
  const correct = entry.options.some((option) => option.correct)
  return correct && wrong.length > 0 && (wrong.length === 1 || wrong[0].count > wrong[1].count)
}

export function cohortReadiness(cohort: CohortOut | null): CohortReadiness {
  if (!cohort) return 'unavailable'
  return cohort.distribution.some(hasClearPattern) ? 'ready' : 'waiting'
}
