/**
 * These tests are the contract with `POST /worlds/{id}/explain/turn`, written
 * down on the client's side of the wire.
 *
 * Two failure modes matter more than the happy path. The first is a 422: every
 * limit in `ExplainChatIn` is enforced here *before* sending, so a learner who
 * types four words gets a hint instead of a round-trip into a validation error
 * they cannot read. The second is a lost conversation: the request body is the
 * whole transcript, so a retry after a failure must produce a byte-identical
 * body. Every case below pins one or the other.
 */

import { describe, expect, it } from 'vitest'

import type { Concept, ExplainChatOut, ExplainOut } from '../api/types'
import { fixtureGraph } from '../fixtures'
import {
  appendLearner,
  applyReply,
  canSend,
  chatBody,
  firstUnexplained,
  MAX_MESSAGE_CHARS,
  MAX_MESSAGES,
  meterLabel,
  openingLine,
  questionsLabel,
  startChat,
  stuckLabel,
} from './explainChat'

const conceptById = (id: string): Concept => {
  const concept = fixtureGraph.concepts.find((candidate) => candidate.id === id)
  if (!concept) throw new Error(`fixture graph is missing concept ${id}`)
  return concept
}

const overfitting = conceptById('overfitting')

/** An `ExplainChatOut` is wide; a test only ever cares about three of its fields. */
const reply = (patch: Partial<ExplainChatOut>): ExplainChatOut => ({
  done: false,
  understanding: 0,
  question: null,
  targeted_misconception_id: null,
  turns_remaining: 4,
  result: null,
  ...patch,
})

const graded = (patch: Partial<ExplainOut> = {}): ExplainOut => ({
  score: 100,
  verdict: 'pass',
  xp_awarded: 25,
  feedback: 'The student gets it now — you answered every follow-up and left no gaps.',
  misconception_id: null,
  concept: { id: overfitting.id, label: overfitting.label, summary: overfitting.summary },
  world_xp: 25,
  server_xp: 25,
  ...patch,
})

const FIRST = 'Overfitting is when a model learns the training data too well.'
const SECOND =
  'The two scores decouple once the model starts fitting noise: training error keeps falling while the error on new data rises.'

describe('openingLine', () => {
  it('names the concept and asks for help, without any of our jargon', () => {
    const line = openingLine('Overfitting')
    expect(line).toBe("I have to explain Overfitting tomorrow and I don't get it. Can you explain it to me?")
  })

  it('degrades rather than printing an empty gap for a blank label', () => {
    expect(openingLine('   ')).toContain('explain this tomorrow')
  })
})

describe('startChat', () => {
  it('puts the student on screen before anything has been sent', () => {
    const state = startChat(overfitting)
    expect(state.turns).toHaveLength(1)
    expect(state.turns[0].role).toBe('student')
    expect(state.done).toBe(false)
    expect(state.result).toBeNull()
    expect(state.questionsLeft).toBeNull()
  })

  it('carries the opening line into the request body, so the server sees what the learner saw', () => {
    const body = chatBody(startChat(overfitting))
    expect(body.concept_id).toBe('overfitting')
    expect(body.turns[0].text).toBe(openingLine('Overfitting'))
  })
})

describe('canSend', () => {
  it('refuses an empty box quietly, and says how far off the floor still is', () => {
    const check = canSend(startChat(overfitting), '   ')
    expect(check.ok).toBe(false)
    expect(check.reason).toBeNull()
    expect(check.charsNeeded).toBe(20)
  })

  it('counts down the 20-character floor as the learner types', () => {
    const check = canSend(startChat(overfitting), 'It memorises')
    expect(check.ok).toBe(false)
    expect(check.charsNeeded).toBe(8)
    expect(check.reason).toBe('8 more characters before you can send it.')
  })

  it('says "character" in the singular one away from the floor', () => {
    const check = canSend(startChat(overfitting), 'a'.repeat(19))
    expect(check.reason).toBe('1 more character before you can send it.')
  })

  it('lets the first real answer through', () => {
    expect(canSend(startChat(overfitting), FIRST)).toEqual({ ok: true, reason: null, charsNeeded: 0 })
  })

  /**
   * The floor is on the learner's whole side of the conversation, exactly as the
   * server computes it — so it binds on the first answer and never again.
   */
  it('stops binding once the learner has already said enough', () => {
    const state = appendLearner(startChat(overfitting), FIRST)
    expect(canSend(state, 'yes').ok).toBe(true)
  })

  it('refuses a message longer than the server will accept', () => {
    const check = canSend(startChat(overfitting), 'x'.repeat(MAX_MESSAGE_CHARS + 5))
    expect(check.ok).toBe(false)
    expect(check.reason).toContain('5 characters too long')
  })

  it('refuses once the transcript is full', () => {
    let state = startChat(overfitting)
    while (state.turns.length < MAX_MESSAGES) {
      state = { ...state, turns: [...state.turns, { role: 'learner', text: FIRST }] }
    }
    const check = canSend(state, FIRST)
    expect(check.ok).toBe(false)
    expect(check.reason).toBe('This conversation has run as long as it can.')
  })

  it('refuses once the transcript is at its character budget', () => {
    const state = { ...startChat(overfitting), turns: [{ role: 'learner' as const, text: 'y'.repeat(1200) }] }
    const bloated = { ...state, turns: Array.from({ length: 7 }, () => state.turns[0]) }
    const check = canSend(bloated, 'x'.repeat(1200))
    expect(check.ok).toBe(false)
    expect(check.reason).toContain('as long as it can')
  })

  it('refuses after the student is done, so a finished panel cannot re-post', () => {
    const state = applyReply(appendLearner(startChat(overfitting), FIRST), reply({ done: true, result: graded() }))
    expect(canSend(state, FIRST).ok).toBe(false)
  })
})

describe('appendLearner', () => {
  it('trims what was typed and keeps the learner last, which the server requires', () => {
    const state = appendLearner(startChat(overfitting), `  ${FIRST}  `)
    expect(state.turns).toHaveLength(2)
    expect(state.turns[1]).toEqual({ role: 'learner', text: FIRST })
  })

  it('hard-caps an over-long message rather than letting it become a 422', () => {
    const state = appendLearner(startChat(overfitting), 'x'.repeat(MAX_MESSAGE_CHARS + 400))
    expect(state.turns[1].text).toHaveLength(MAX_MESSAGE_CHARS)
  })

  it('ignores an empty message and a finished conversation', () => {
    const fresh = startChat(overfitting)
    expect(appendLearner(fresh, '   ')).toBe(fresh)
    const over = applyReply(appendLearner(fresh, FIRST), reply({ done: true, result: graded() }))
    expect(appendLearner(over, FIRST)).toBe(over)
  })

  /**
   * A failed send leaves the learner's message in the transcript. Retrying must
   * post the same bytes: the endpoint is stateless, so an extra copy of the
   * message would change what the student is answering.
   */
  it('makes a retry byte-identical', () => {
    const state = appendLearner(startChat(overfitting), FIRST)
    expect(JSON.stringify(chatBody(state))).toBe(JSON.stringify(chatBody(state)))
    expect(chatBody(state).turns).toHaveLength(2)
  })
})

describe('applyReply', () => {
  it('adds the follow-up question and moves the meter', () => {
    const asked = reply({
      understanding: 47,
      question: 'Wait — I thought 99 percent on training means roughly 99 percent on new data. Why is that not right?',
      targeted_misconception_id: 'high_train_high_test',
      turns_remaining: 3,
    })
    const state = applyReply(appendLearner(startChat(overfitting), FIRST), asked)

    expect(state.turns.map((turn) => turn.role)).toEqual(['student', 'learner', 'student'])
    expect(state.turns[2].text).toBe(asked.question)
    expect(state.understanding).toBe(47)
    expect(state.questionsLeft).toBe(3)
    expect(state.done).toBe(false)
    expect(state.result).toBeNull()
  })

  it('resolves what the student is stuck on into the wrong belief, never the correction', () => {
    const state = applyReply(
      appendLearner(startChat(overfitting), FIRST),
      reply({ understanding: 47, question: 'why?', targeted_misconception_id: 'high_train_high_test' }),
    )
    expect(state.stuckOn).toBe('99 percent on training means roughly 99 percent on new data.')
    expect(stuckLabel(state)).toBe('They still believe: "99 percent on training means roughly 99 percent on new data."')
    const correction = overfitting.misconceptions[0].correction
    expect(stuckLabel(state)).not.toContain(correction)
  })

  it('shows no caption for an id the graph does not know', () => {
    const state = applyReply(
      appendLearner(startChat(overfitting), FIRST),
      reply({ question: 'why?', targeted_misconception_id: 'not_in_this_graph' }),
    )
    expect(state.stuckOn).toBeNull()
    expect(stuckLabel(state)).toBeNull()
  })

  it('takes the graded score on the last reply and stops asking', () => {
    const state = applyReply(
      appendLearner(startChat(overfitting), SECOND),
      reply({ done: true, understanding: 100, result: graded({ score: 78, xp_awarded: 25 }) }),
    )
    expect(state.done).toBe(true)
    expect(state.understanding).toBe(78)
    expect(state.questionsLeft).toBe(0)
    expect(state.stuckOn).toBeNull()
    expect(state.result?.xp_awarded).toBe(25)
    // No question is ever appended on the final reply: `result` is the closing line.
    expect(state.turns.map((turn) => turn.role)).toEqual(['student', 'learner'])
  })

  it('clamps a score outside 0-100 rather than rendering a broken bar', () => {
    const high = applyReply(startChat(overfitting), reply({ understanding: 140 }))
    const low = applyReply(startChat(overfitting), reply({ understanding: -12 }))
    expect(high.understanding).toBe(100)
    expect(low.understanding).toBe(0)
  })

  it('survives a reply with nothing in it', () => {
    const state = applyReply(startChat(overfitting), reply({ question: '   ', turns_remaining: -3 }))
    expect(state.turns).toHaveLength(1)
    expect(state.questionsLeft).toBe(0)
  })
})

describe('labels', () => {
  it('reads the meter in plain language', () => {
    const state = applyReply(appendLearner(startChat(overfitting), FIRST), reply({ understanding: 65 }))
    expect(meterLabel(state)).toBe('The student understands: 65%')
  })

  it('counts the questions left so the ending is never a surprise', () => {
    const many = applyReply(startChat(overfitting), reply({ question: 'why?', turns_remaining: 2 }))
    const one = applyReply(startChat(overfitting), reply({ question: 'why?', turns_remaining: 1 }))
    expect(questionsLabel(many)).toBe('2 questions left')
    expect(questionsLabel(one)).toBe('1 question left')
  })

  it('says nothing about questions left before the first reply, or once it is over', () => {
    expect(questionsLabel(startChat(overfitting))).toBeNull()
    const over = applyReply(appendLearner(startChat(overfitting), FIRST), reply({ done: true, result: graded() }))
    expect(questionsLabel(over)).toBeNull()
  })

  /** The words the owner rejected must not reach a learner through this module. */
  it("never leaks the team's vocabulary", () => {
    const state = applyReply(
      appendLearner(startChat(overfitting), FIRST),
      reply({ understanding: 47, question: 'why?', targeted_misconception_id: 'high_train_high_test' }),
    )
    const onScreen = [
      openingLine(overfitting.label),
      meterLabel(state),
      questionsLabel(state) ?? '',
      stuckLabel(state) ?? '',
      canSend(state, 'short').reason ?? '',
      canSend(state, 'x'.repeat(2000)).reason ?? '',
    ]
      .join(' ')
      .toLowerCase()

    for (const banned of [
      'gauntlet',
      'archetype',
      'misconception',
      'source span',
      'schema',
      'verdict',
      'diagnosis',
      'concept_id',
      'understanding score',
      'transcript',
      'turn',
    ]) {
      expect(onScreen).not.toContain(banned)
    }
  })
})

describe('firstUnexplained', () => {
  it('opens on the first concept the learner has never explained', () => {
    const concept = firstUnexplained(fixtureGraph.concepts, new Set(['training_data', 'generalisation']))
    expect(concept?.id).toBe('overfitting')
  })

  it('falls back to the first concept once every one has been explained', () => {
    const all = new Set(fixtureGraph.concepts.map((concept) => concept.id))
    expect(firstUnexplained(fixtureGraph.concepts, all)?.id).toBe('training_data')
  })

  it('has nothing to teach from an empty graph', () => {
    expect(firstUnexplained([], new Set())).toBeNull()
  })
})
