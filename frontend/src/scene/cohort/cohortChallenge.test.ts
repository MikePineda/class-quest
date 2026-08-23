import { describe, expect, it } from 'vitest'

import type { CohortOut } from '../../api/types'
import { selectCohortChallenge } from './challenge'

const cohort = (distribution: CohortOut['distribution']): CohortOut => ({
  server_id: 'server',
  me: null,
  entries: [],
  members_count: 4,
  predictions_made: 4,
  distribution,
  hardest_concept: null,
})

describe('selectCohortChallenge', () => {
  it('selects the strongest strict wrong-answer pattern', () => {
    const result = selectCohortChallenge(
      cohort([
        {
          world_id: 'world',
          scene_id: 'scene-b',
          concept_id: 'concept-b',
          options: [
            { option_id: 'wrong', text: 'A tempting idea', correct: false, count: 4, pct: 100 },
            { option_id: 'right', text: 'The evidence-backed idea', correct: true, count: 0, pct: 0 },
          ],
        },
        {
          world_id: 'world',
          scene_id: 'scene-a',
          concept_id: 'concept-a',
          options: [
            { option_id: 'wrong', text: 'A tempting idea', correct: false, count: 3, pct: 75 },
            { option_id: 'right', text: 'The evidence-backed idea', correct: true, count: 1, pct: 25 },
          ],
        },
      ]),
    )

    expect(result?.sceneId).toBe('scene-b')
    expect(result?.majorityWrong.option_id).toBe('wrong')
    expect(result?.correctOption.option_id).toBe('right')
  })

  it('refuses thin or tied evidence', () => {
    expect(
      selectCohortChallenge(
        cohort([
          {
            world_id: 'world',
            scene_id: 'scene',
            concept_id: 'concept',
            options: [
              { option_id: 'a', text: 'A', correct: false, count: 1, pct: 50 },
              { option_id: 'b', text: 'B', correct: true, count: 1, pct: 50 },
            ],
          },
        ]),
      ),
    ).toBeNull()
  })
})
