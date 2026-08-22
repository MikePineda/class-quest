/**
 * These tests are mostly about refusing to say things.
 *
 * The arithmetic is trivial; what is not trivial is the boundary between a
 * number the class produced and a number one person produced, and every case
 * below pins one side of it. The second half is total-ness: the payload comes
 * off the wire mid-run and may be half-shaped, and a throw in here would blank
 * a screen the learner reached by finishing the world.
 */

import { describe, expect, it } from 'vitest'

import type { CohortOut, CourseGraph } from '../../api/types'
import type { ConceptProgress } from '../pedagogy'
import { MIN_CLASS_PLAYERS, MIN_ECHO_ANSWERS, classSnapshot, masterySummary, sceneEcho } from './cohortStats'

const cohort = (patch: Partial<CohortOut>): CohortOut => ({
  server_id: 'srv',
  me: null,
  entries: [],
  members_count: 0,
  predictions_made: 0,
  distribution: [],
  hardest_concept: null,
  ...patch,
})

/** One question: two people right, one on trap A, one on trap B. */
const scene = (counts: { a: number; b: number; c: number }) => ({
  world_id: 'w1',
  scene_id: 'g_1',
  concept_id: 'overfitting',
  options: [
    { option_id: 'a', text: 'The model memorised the training set', correct: true, count: counts.a, pct: 0 },
    {
      option_id: 'b',
      text: 'More features always help',
      correct: false,
      misconception_id: 'mc_more_features',
      count: counts.b,
      pct: 0,
    },
    {
      option_id: 'c',
      text: 'The data was shuffled wrong',
      correct: false,
      misconception_id: 'mc_shuffle',
      count: counts.c,
      pct: 0,
    },
  ],
})

/**
 * `mc_more_features` deliberately lives on a *different* concept than the scene
 * teaches: real generated content puts cross-concept distractors on a question,
 * and resolving ids per-concept drops them.
 */
const graph = {
  schema_version: '1.0',
  graph_id: 'g',
  source: { title: 'Notes', segment_count: 1 },
  concepts: [
    { id: 'overfitting', label: 'Overfitting', summary: '', bloom_level: 'understand', prerequisites: [], source_spans: [], misconceptions: [] },
    {
      id: 'features',
      label: 'Feature selection',
      summary: '',
      bloom_level: 'understand',
      prerequisites: [],
      source_spans: [],
      misconceptions: [
        {
          id: 'mc_more_features',
          statement: 'Adding more features can only make a model better',
          why_plausible: '',
          correction: '',
        },
      ],
    },
  ],
} as unknown as CourseGraph

describe('sceneEcho: when there is nothing to say', () => {
  it('is null without a payload', () => {
    expect(sceneEcho(null, 'g_1')).toBeNull()
    expect(sceneEcho(undefined, 'g_1')).toBeNull()
  })

  it('is null for a scene nobody has reached', () => {
    // `distribution` is [] until somebody answers, and carries only answered scenes.
    expect(sceneEcho(cohort({ distribution: [scene({ a: 2, b: 1, c: 0 }) ] }), 'g_other')).toBeNull()
  })

  it('is null for an entry with no answers counted in it', () => {
    expect(sceneEcho(cohort({ distribution: [scene({ a: 0, b: 0, c: 0 })] }), 'g_1')).toBeNull()
  })

  it('is null for an empty scene id', () => {
    expect(sceneEcho(cohort({ distribution: [scene({ a: 1, b: 0, c: 0 })] }), '')).toBeNull()
  })
})

describe('sceneEcho: thin data', () => {
  it('reports a single answer without calling it a pattern', () => {
    // The one-player case: structurally valid, diagnostically useless. The
    // numbers come back, `enough` does not.
    const echo = sceneEcho(cohort({ distribution: [scene({ a: 1, b: 0, c: 0 })] }), 'g_1')
    expect(echo?.answers).toBe(1)
    expect(echo?.enough).toBe(false)
    expect(echo?.options.find((option) => option.optionId === 'a')?.pct).toBe(100)
  })

  it('turns honest exactly at the documented threshold', () => {
    const below = sceneEcho(cohort({ distribution: [scene({ a: 1, b: 1, c: 0 })] }), 'g_1')
    expect(below?.answers).toBe(MIN_ECHO_ANSWERS - 1)
    expect(below?.enough).toBe(false)

    const at = sceneEcho(cohort({ distribution: [scene({ a: 1, b: 2, c: 0 })] }), 'g_1')
    expect(at?.answers).toBe(MIN_ECHO_ANSWERS)
    expect(at?.enough).toBe(true)
  })
})

describe('sceneEcho: the shares', () => {
  it('recomputes shares from the counts on screen, not from the server rounding', () => {
    const echo = sceneEcho(cohort({ distribution: [scene({ a: 1, b: 3, c: 0 })] }), 'g_1')
    expect(echo?.answers).toBe(4)
    expect(echo?.options.map((option) => option.pct)).toEqual([25, 75, 0])
  })

  it('marks the learner’s own answer and nothing else', () => {
    const echo = sceneEcho(cohort({ distribution: [scene({ a: 2, b: 2, c: 1 })] }), 'g_1', {
      chosenOptionId: 'c',
    })
    expect(echo?.options.filter((option) => option.mine).map((option) => option.optionId)).toEqual(['c'])
  })

  it('marks nothing when no answer was committed', () => {
    const echo = sceneEcho(cohort({ distribution: [scene({ a: 2, b: 2, c: 1 })] }), 'g_1')
    expect(echo?.options.some((option) => option.mine)).toBe(false)
  })
})

describe('sceneEcho: the trap', () => {
  it('names the wrong option that beat every other one', () => {
    const echo = sceneEcho(cohort({ distribution: [scene({ a: 1, b: 4, c: 1 })] }), 'g_1')
    expect(echo?.trap?.optionId).toBe('b')
    expect(echo?.trap?.count).toBe(4)
  })

  it('says nothing on a tie, because a coin flip is not a finding', () => {
    const echo = sceneEcho(cohort({ distribution: [scene({ a: 1, b: 2, c: 2 })] }), 'g_1')
    expect(echo?.trap).toBeNull()
  })

  it('never calls the right answer a trap, however popular it is', () => {
    const echo = sceneEcho(cohort({ distribution: [scene({ a: 9, b: 0, c: 0 })] }), 'g_1')
    expect(echo?.trap).toBeNull()
  })

  it('puts the mistake in the learner’s words, resolving the belief graph-wide', () => {
    // `mc_more_features` is owned by `features`, not by the scene's concept.
    const echo = sceneEcho(cohort({ distribution: [scene({ a: 1, b: 3, c: 0 })] }), 'g_1', { graph })
    expect(echo?.trap?.belief).toBe('Adding more features can only make a model better')
  })

  it('falls back to the option wording rather than inventing a belief', () => {
    const echo = sceneEcho(cohort({ distribution: [scene({ a: 1, b: 0, c: 3 })] }), 'g_1', { graph })
    expect(echo?.trap?.belief).toBeNull()
    expect(echo?.trap?.text).toBe('The data was shuffled wrong')
  })
})

describe('sceneEcho: totality', () => {
  it('survives a distribution shaped like nothing at all', () => {
    const broken = {
      distribution: [
        { scene_id: 'g_1', options: null },
        { scene_id: 'g_1', options: [{ option_id: 'a', text: 'x', count: 'lots' }] },
      ],
    } as unknown as CohortOut
    expect(() => sceneEcho(broken, 'g_1')).not.toThrow()
    expect(sceneEcho(broken, 'g_1')).toBeNull()
  })

  it('drops options with no id or no text instead of drawing a blank bar', () => {
    const partial = {
      distribution: [
        {
          scene_id: 'g_1',
          options: [
            { option_id: 'a', text: 'Real option', correct: true, count: 3 },
            { option_id: '', text: 'No id', correct: false, count: 5 },
            { option_id: 'b', text: '   ', correct: false, count: 5 },
          ],
        },
      ],
    } as unknown as CohortOut
    const echo = sceneEcho(partial, 'g_1')
    expect(echo?.options).toHaveLength(1)
    expect(echo?.answers).toBe(3)
  })
})

// ---------------------------------------------------------------------------

const entry = (id: string, xp: number, attempts: number, rank: number) => ({
  rank,
  user_id: id,
  display_name: id.toUpperCase(),
  xp,
  attempts,
})

describe('classSnapshot: who is actually here', () => {
  it('is null without a payload', () => {
    expect(classSnapshot(null)).toBeNull()
  })

  it('counts players by recorded answers, not by membership', () => {
    // A class of thirty where one person has played is a class of one for
    // anything measured from answers.
    const snapshot = classSnapshot(
      cohort({
        members_count: 30,
        predictions_made: 12,
        entries: [entry('me', 40, 12, 1), entry('nobody', 0, 0, 2)],
      }),
    )
    expect(snapshot?.membersCount).toBe(30)
    expect(snapshot?.playersCount).toBe(1)
    expect(snapshot?.enough).toBe(false)
  })

  it('turns honest once enough people have actually answered', () => {
    const snapshot = classSnapshot(
      cohort({
        members_count: 3,
        predictions_made: 9,
        entries: [entry('a', 40, 5, 1), entry('b', 20, 4, 2), entry('c', 0, 0, 3)],
      }),
    )
    expect(snapshot?.playersCount).toBe(MIN_CLASS_PLAYERS)
    expect(snapshot?.enough).toBe(true)
  })
})

describe('classSnapshot: the hardest idea', () => {
  const hardest = { concept_id: 'overfitting', label: 'Overfitting', wrong_pct: 71 }

  it('is withheld while one player’s own mistakes would be the whole finding', () => {
    const snapshot = classSnapshot(
      cohort({ members_count: 8, predictions_made: 4, entries: [entry('me', 10, 4, 1)], hardest_concept: hardest }),
    )
    expect(snapshot?.hardest).toBeNull()
  })

  it('is null when the server has none, which is the state before anybody answers', () => {
    const snapshot = classSnapshot(
      cohort({ predictions_made: 0, entries: [entry('a', 0, 0, 1)], hardest_concept: null }),
    )
    expect(snapshot?.hardest).toBeNull()
  })

  it('names it once the class is real', () => {
    const snapshot = classSnapshot(
      cohort({
        members_count: 3,
        predictions_made: 20,
        entries: [entry('a', 40, 9, 1), entry('b', 30, 11, 2)],
        hardest_concept: hardest,
      }),
    )
    expect(snapshot?.hardest).toEqual({ label: 'Overfitting', wrongPct: 71 })
  })
})

describe('classSnapshot: the board', () => {
  const many = Array.from({ length: 9 }, (_, i) => entry(`u${i}`, 100 - i * 10, 3, i + 1))

  it('marks the reader’s row from `me`, never from a display name', () => {
    const snapshot = classSnapshot(cohort({ entries: many, me: many[2] }), { limit: 5 })
    expect(snapshot?.rows.filter((row) => row.mine).map((row) => row.userId)).toEqual(['u2'])
    // Already visible, so there is no separate row to append.
    expect(snapshot?.myRow).toBeNull()
  })

  it('carries the reader’s row separately when it falls off the end', () => {
    const snapshot = classSnapshot(cohort({ entries: many, me: many[7] }), { limit: 5 })
    expect(snapshot?.rows).toHaveLength(5)
    expect(snapshot?.myRow?.userId).toBe('u7')
    expect(snapshot?.rankedCount).toBe(9)
  })

  it('highlights nobody when `me` is null, which is every player with no attempt', () => {
    // A member with zero attempts still appears in `entries`; `me` stays null.
    const snapshot = classSnapshot(cohort({ entries: many, me: null }), { limit: 5 })
    expect(snapshot?.rows.some((row) => row.mine)).toBe(false)
    expect(snapshot?.myRow).toBeNull()
  })

  it('gives a nameless entry a placeholder instead of an empty row', () => {
    const snapshot = classSnapshot({
      entries: [{ rank: 1, user_id: 'x', display_name: '  ', xp: 3, attempts: 1 }],
    } as unknown as CohortOut)
    expect(snapshot?.rows[0].name).toBe('Someone')
  })

  it('survives entries that are not entries', () => {
    const broken = { entries: [null, { user_id: 'ok', xp: 'lots' }, { display_name: 'no id' }] } as unknown as CohortOut
    expect(() => classSnapshot(broken)).not.toThrow()
    expect(classSnapshot(broken)?.rows).toHaveLength(1)
    expect(classSnapshot(broken)?.rows[0].xp).toBe(0)
  })
})

// ---------------------------------------------------------------------------

const progress = (id: string, state: ConceptProgress['state']): ConceptProgress => ({
  concept: {
    id,
    label: id,
    summary: '',
    bloom_level: 'understand',
    prerequisites: [],
    source_spans: [],
    misconceptions: [],
  },
  total: 2,
  done: 2,
  state,
})

describe('masterySummary', () => {
  it('splits the trail by the verdict the trail already made', () => {
    const summary = masterySummary([
      progress('a', 'mastered'),
      progress('b', 'in_progress'),
      progress('c', 'available'),
      progress('d', 'locked'),
    ])
    expect(summary.mastered.map((entry) => entry.concept.id)).toEqual(['a'])
    expect(summary.practised.map((entry) => entry.concept.id)).toEqual(['b'])
    expect(summary.untouched.map((entry) => entry.concept.id)).toEqual(['c', 'd'])
    expect(summary.total).toBe(4)
  })

  it('is empty, not broken, on a trail that never loaded', () => {
    expect(() => masterySummary(null)).not.toThrow()
    expect(masterySummary(undefined).total).toBe(0)
    expect(masterySummary([null, { concept: null }] as unknown as ConceptProgress[]).total).toBe(0)
  })
})
