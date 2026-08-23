/**
 * Gating is three tiny rules, and every one of them is a claim the UI makes to
 * the learner ("this portal is done"). The cases below pin the boundaries where
 * a claim would go wrong: the off-by-one at the quiz threshold, an empty world
 * silently declaring itself finished, and a correct answer from somewhere else
 * leaking into the count.
 *
 * The fourth door is a fourth claim now ("the run is over"), so it gets the same
 * treatment: it opens on exactly the three clears and never on its own say-so,
 * and it can never be what a world is waiting for.
 *
 * The other half is total-ness. These inputs are assembled from HTTP payloads
 * and from client state that may not have loaded yet, so no shape of input may
 * throw — a throw here blanks the hub.
 */

import { describe, expect, it } from 'vitest'

import type { ClearInput, ClearState } from './gating'
import { QUIZ_PASS_RATIO, clearedPortals, closureOpen, quizThreshold, worldCleared } from './gating'

/** An input that clears nothing, so each test can turn on exactly one thing. */
const emptyInput: ClearInput = {
  conceptIds: [],
  readConceptIds: new Set(),
  quizSceneIds: [],
  correctSceneIds: new Set(),
  explainedConceptIds: new Set(),
}

const input = (patch: Partial<ClearInput>): ClearInput => ({ ...emptyInput, ...patch })

describe('QUIZ_PASS_RATIO', () => {
  it('is the documented 0.8', () => {
    expect(QUIZ_PASS_RATIO).toBe(0.8)
  })
})

describe('quizThreshold', () => {
  it('is unreachable for a gauntlet with no questions', () => {
    // One correct answer out of zero questions: never satisfiable, by design.
    expect(quizThreshold(0)).toBe(1)
  })

  it('needs the single question when there is one', () => {
    expect(quizThreshold(1)).toBe(1)
  })

  it('rounds up to all three at n=3, which is why the copy says "N of M"', () => {
    expect(quizThreshold(3)).toBe(3)
  })

  it('matches ceil(0.8n) across the sizes a generated gauntlet actually has', () => {
    expect(quizThreshold(5)).toBe(4)
    expect(quizThreshold(8)).toBe(7)
    expect(quizThreshold(10)).toBe(8)
  })

  it('never returns less than one, whatever nonsense it is handed', () => {
    expect(quizThreshold(-4)).toBe(1)
    expect(quizThreshold(Number.NaN)).toBe(1)
    expect(quizThreshold(2.5)).toBe(2)
  })
})

describe('clearedPortals: storybook', () => {
  it('clears once every concept has been opened', () => {
    const state = clearedPortals(
      input({ conceptIds: ['a', 'b'], readConceptIds: new Set(['a', 'b']) }),
    )
    expect(state.storybook).toBe(true)
  })

  it('stays unclear while one concept is unread', () => {
    const state = clearedPortals(
      input({ conceptIds: ['a', 'b'], readConceptIds: new Set(['a']) }),
    )
    expect(state.storybook).toBe(false)
  })

  it('never clears a world with no concepts, however many receipts exist', () => {
    const state = clearedPortals(input({ readConceptIds: new Set(['a', 'b']) }))
    expect(state.storybook).toBe(false)
  })
})

describe('clearedPortals: quiz', () => {
  it('clears at the threshold and not one answer before it', () => {
    const quizSceneIds = ['q1', 'q2', 'q3', 'q4', 'q5']

    const three = clearedPortals(
      input({ quizSceneIds, correctSceneIds: new Set(['q1', 'q2', 'q3']) }),
    )
    expect(three.quiz).toBe(false)

    const four = clearedPortals(
      input({ quizSceneIds, correctSceneIds: new Set(['q1', 'q2', 'q3', 'q4']) }),
    )
    expect(four.quiz).toBe(true)
  })

  it('ignores correct scenes that are not questions in this gauntlet', () => {
    // A quest scene the learner got right must not pay for the gauntlet.
    const state = clearedPortals(
      input({
        quizSceneIds: ['q1', 'q2', 'q3', 'q4', 'q5'],
        correctSceneIds: new Set(['q1', 'q2', 'q3', 'sc_quest_a', 'sc_quest_b', 'sc_quest_c']),
      }),
    )
    expect(state.quiz).toBe(false)
  })

  it('never clears a gauntlet with no questions', () => {
    const state = clearedPortals(input({ correctSceneIds: new Set(['q1']) }))
    expect(state.quiz).toBe(false)
  })

  it('clears a single-question gauntlet on that one answer', () => {
    const state = clearedPortals(
      input({ quizSceneIds: ['q1'], correctSceneIds: new Set(['q1']) }),
    )
    expect(state.quiz).toBe(true)
  })
})

describe('clearedPortals: explain', () => {
  it('clears on the first explained concept', () => {
    const state = clearedPortals(
      input({ conceptIds: ['a', 'b'], explainedConceptIds: new Set(['b']) }),
    )
    expect(state.explain).toBe(true)
  })

  it('stays unclear while nothing has been explained', () => {
    const state = clearedPortals(input({ conceptIds: ['a', 'b'] }))
    expect(state.explain).toBe(false)
  })

  it('only counts explanations of concepts this world teaches', () => {
    const state = clearedPortals(
      input({ conceptIds: ['a'], explainedConceptIds: new Set(['from_another_world']) }),
    )
    expect(state.explain).toBe(false)
  })
})

describe('clearedPortals: sealed', () => {
  it('is sealed on an empty world', () => {
    expect(clearedPortals(emptyInput).sealed).toBe(false)
  })

  it('unseals once all three teaching portals are cleared', () => {
    // This is the whole change: the fourth door used to be scenery. It now
    // opens onto the closing summary, which reports the server's numbers and
    // awards nothing — so a browser-side clear is allowed to decide it.
    const state = clearedPortals({
      conceptIds: ['a'],
      readConceptIds: new Set(['a']),
      quizSceneIds: ['q1'],
      correctSceneIds: new Set(['q1']),
      explainedConceptIds: new Set(['a']),
    })
    expect(state.sealed).toBe(true)
    expect(closureOpen(state)).toBe(true)
  })

  it('stays sealed while any one teaching portal is open', () => {
    const base = {
      conceptIds: ['a'],
      readConceptIds: new Set(['a']),
      quizSceneIds: ['q1'],
      correctSceneIds: new Set(['q1']),
      explainedConceptIds: new Set(['a']),
    }
    expect(clearedPortals({ ...base, readConceptIds: new Set<string>() }).sealed).toBe(false)
    expect(clearedPortals({ ...base, correctSceneIds: new Set<string>() }).sealed).toBe(false)
    expect(clearedPortals({ ...base, explainedConceptIds: new Set<string>() }).sealed).toBe(false)
  })

  it('agrees with worldCleared, because it is derived from it', () => {
    const state = clearedPortals({
      conceptIds: ['a', 'b'],
      readConceptIds: new Set(['a', 'b']),
      quizSceneIds: ['q1', 'q2', 'q3'],
      correctSceneIds: new Set(['q1', 'q2', 'q3']),
      explainedConceptIds: new Set(['b']),
    })
    expect(state.sealed).toBe(worldCleared(state))
  })
})

describe('closureOpen', () => {
  it('reads the fourth door and nothing else', () => {
    expect(closureOpen({ storybook: true, quiz: true, explain: true, sealed: true })).toBe(true)
    expect(closureOpen({ storybook: true, quiz: true, explain: true, sealed: false })).toBe(false)
  })

  it('treats any state that is not a state as sealed', () => {
    // A door that opens on garbage is worse than a door that stays shut.
    expect(closureOpen(undefined as unknown as ClearState)).toBe(false)
    expect(closureOpen({ sealed: 'yes' } as unknown as ClearState)).toBe(false)
  })
})

describe('clearedPortals: totality', () => {
  it('clears nothing on empty input and does not throw', () => {
    expect(() => clearedPortals(emptyInput)).not.toThrow()
    expect(clearedPortals(emptyInput)).toEqual({
      storybook: false,
      quiz: false,
      explain: false,
      sealed: false,
    })
  })

  it('survives missing lists and sets from a half-loaded world', () => {
    // Deliberately lying to the type system: this is the shape a partially
    // fetched world really has at first paint.
    const malformed = {
      conceptIds: undefined,
      readConceptIds: undefined,
      quizSceneIds: null,
      correctSceneIds: null,
      explainedConceptIds: undefined,
    } as unknown as ClearInput

    expect(() => clearedPortals(malformed)).not.toThrow()
    expect(clearedPortals(malformed)).toEqual({
      storybook: false,
      quiz: false,
      explain: false,
      sealed: false,
    })
  })

  it('survives an input object that is missing entirely', () => {
    expect(() => clearedPortals(undefined as unknown as ClearInput)).not.toThrow()
    expect(clearedPortals(undefined as unknown as ClearInput).quiz).toBe(false)
  })
})

describe('worldCleared', () => {
  it('is true only when all three openable portals are cleared', () => {
    const state = clearedPortals({
      conceptIds: ['a', 'b'],
      readConceptIds: new Set(['a', 'b']),
      quizSceneIds: ['q1', 'q2', 'q3'],
      correctSceneIds: new Set(['q1', 'q2', 'q3']),
      explainedConceptIds: new Set(['a']),
    })
    expect(worldCleared(state)).toBe(true)
  })

  it('is false while any one of them is open', () => {
    expect(worldCleared({ storybook: false, quiz: true, explain: true, sealed: false })).toBe(false)
    expect(worldCleared({ storybook: true, quiz: false, explain: true, sealed: false })).toBe(false)
    expect(worldCleared({ storybook: true, quiz: true, explain: false, sealed: false })).toBe(false)
  })

  it('does not wait on the sealed portal, which now depends on it', () => {
    // This used to hold because `sealed` was permanently false. It has to keep
    // holding for a stronger reason: `sealed` is derived from these three, so
    // counting it here would be circular — the fourth door would wait on a
    // world that waits on the fourth door, and neither would ever open.
    // A `sealed: false` handed in from anywhere (a stale state, a hand-built
    // one) therefore cannot hold a cleared world back.
    expect(worldCleared({ storybook: true, quiz: true, explain: true, sealed: false })).toBe(true)
    expect(worldCleared({ storybook: true, quiz: true, explain: true, sealed: true })).toBe(true)
    // And an unsealed door never stands in for a portal nobody cleared.
    expect(worldCleared({ storybook: false, quiz: true, explain: true, sealed: true })).toBe(false)
  })

  it('never throws on an empty world', () => {
    expect(worldCleared(clearedPortals(emptyInput))).toBe(false)
  })
})
