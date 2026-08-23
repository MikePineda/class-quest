import { describe, expect, it } from 'vitest'

import type { CohortOut } from '../api/types'
import { cohortReadiness } from './cohortReadiness'

const base = (distribution: CohortOut['distribution']): CohortOut => ({
  server_id: 'server',
  me: null,
  entries: [],
  members_count: 4,
  predictions_made: 4,
  distribution,
  hardest_concept: null,
})

describe('cohortReadiness', () => {
  it('distinguishes unavailable, waiting, and ready states', () => {
    expect(cohortReadiness(null)).toBe('unavailable')
    expect(cohortReadiness(base([]))).toBe('waiting')
    expect(
      cohortReadiness(
        base([
          {
            world_id: 'world',
            scene_id: 'scene',
            concept_id: 'concept',
            options: [
              { option_id: 'wrong', text: 'Wrong', correct: false, count: 3, pct: 75 },
              { option_id: 'right', text: 'Right', correct: true, count: 1, pct: 25 },
            ],
          },
        ]),
      ),
    ).toBe('ready')
  })

  it('does not call a tie a class pattern', () => {
    expect(
      cohortReadiness(
        base([
          {
            world_id: 'world',
            scene_id: 'scene',
            concept_id: 'concept',
            options: [
              { option_id: 'a', text: 'A', correct: false, count: 2, pct: 50 },
              { option_id: 'b', text: 'B', correct: false, count: 2, pct: 50 },
              { option_id: 'right', text: 'Right', correct: true, count: 0, pct: 0 },
            ],
          },
        ]),
      ),
    ).toBe('waiting')
  })
})
