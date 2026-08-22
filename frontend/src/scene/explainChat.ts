/**
 * The Explain-to-Win conversation, as a value.
 *
 * The learner teaches a concept to an AI student that keeps asking why until it
 * understands. This module owns every decision in that loop — what the student
 * opens with, what may be sent, what the reply means — so `ExplainPanel.tsx`
 * only has to render. No React, no fetch, no clock lives here.
 *
 * Three things are deliberate:
 *
 * - **The whole conversation is the request body.** The server keeps no chat
 *   state: `POST /worlds/{id}/explain/turn` is a pure function of
 *   (concept, turns). `chatBody(state)` is therefore stable, which is what makes
 *   a retry after a failure cost exactly one button press — the identical body
 *   goes back over the wire and nothing is lost.
 * - **The opening line never touches the network.** The student's first message
 *   is generated here and carried in the transcript, so the panel has something
 *   on screen the instant it mounts.
 * - **Every server limit is enforced before sending.** `ExplainChatIn` rejects
 *   more than 12 messages, more than 1200 characters in one, more than 8000 in
 *   total, a conversation not ending on the learner, and fewer than 20
 *   characters of learner text. A 422 for any of those is a bug in `canSend`,
 *   not a state the learner should ever meet.
 *
 * Nothing in this file may use the team's internal vocabulary: every string it
 * returns is read by a first-year student who has never seen our docs.
 */

import type { Concept, ExplainChatIn, ExplainChatOut, ExplainOut, ExplainTurn } from '../api/types'

/** Mirrors of `schemas.ExplainChatIn`. Changing one without the other is a 422. */
export const MAX_MESSAGES = 12
export const MAX_MESSAGE_CHARS = 1200
export const MAX_TOTAL_CHARS = 8000
export const MIN_LEARNER_CHARS = 20

export interface ChatState {
  /** What is being explained. Held here so `applyReply` stays a pure 2-arg call. */
  concept: Concept
  /** The whole conversation, in order, exactly as it is posted. */
  turns: ExplainTurn[]
  /** 0-100. How much of the concept the AI student has got so far. */
  understanding: number
  /** `turns_remaining`, or null before the first reply has landed. */
  questionsLeft: number | null
  /** The wrong idea the student is still holding, in its own words. */
  stuckOn: string | null
  done: boolean
  /** The graded outcome. Non-null exactly when `done`. */
  result: ExplainOut | null
}

/** The verdict of `canSend`, ready to render. */
export interface SendCheck {
  ok: boolean
  /**
   * What to show under the box: a live hint while the answer is too short, a
   * plain refusal when a limit is hit, null when there is nothing to say.
   */
  reason: string | null
  /** Characters still missing before the learner has said enough. 0 when satisfied. */
  charsNeeded: number
}

const clamp = (value: number): number => {
  if (!Number.isFinite(value)) return 0
  return Math.min(100, Math.max(0, Math.round(value)))
}

const learnerText = (turns: readonly ExplainTurn[], draft = ''): string => {
  const parts = turns.filter((turn) => turn.role === 'learner').map((turn) => turn.text)
  if (draft) parts.push(draft)
  // The server's own rule: join every learner line with a space, then strip.
  return parts.join(' ').trim()
}

const totalChars = (turns: readonly ExplainTurn[]): number =>
  turns.reduce((sum, turn) => sum + turn.text.length, 0)

/**
 * What the AI student says before anything has been sent.
 *
 * Client-side on purpose: the panel must have a face and a voice the moment it
 * opens, and this line is carried into the first request so the conversation
 * the server sees is the conversation on screen.
 */
export function openingLine(label: string): string {
  const name = label.trim() || 'this'
  return `I have to explain ${name} tomorrow and I don't get it. Can you explain it to me?`
}

/** A fresh conversation: the student has spoken, the learner has not. */
export function startChat(concept: Concept): ChatState {
  return {
    concept,
    turns: [{ role: 'student', text: openingLine(concept.label) }],
    understanding: 0,
    questionsLeft: null,
    stuckOn: null,
    done: false,
    result: null,
  }
}

/** The request body for the conversation as it stands. Stable across retries. */
export const chatBody = (state: ChatState): ExplainChatIn => ({
  concept_id: state.concept.id,
  turns: state.turns,
})

/**
 * Add what the learner just wrote.
 *
 * Trims and hard-caps the length rather than trusting the caller: this is the
 * last place before the wire, and a message one character over the limit would
 * come back as a validation error the learner cannot act on.
 */
export function appendLearner(state: ChatState, text: string): ChatState {
  if (state.done) return state
  const said = text.trim().slice(0, MAX_MESSAGE_CHARS)
  if (!said) return state
  if (state.turns.length >= MAX_MESSAGES) return state
  return { ...state, turns: [...state.turns, { role: 'learner', text: said }] }
}

/**
 * Fold one reply into the conversation.
 *
 * `question` is non-null exactly while the student still wants something, and
 * `result` exactly once it is finished, so the two branches never overlap.
 */
export function applyReply(state: ChatState, reply: ExplainChatOut): ChatState {
  const done = Boolean(reply.done)
  const result = done ? (reply.result ?? null) : null
  const question = typeof reply.question === 'string' ? reply.question.trim() : ''

  return {
    ...state,
    // On the last reply the graded score is the honest number: it is what was
    // written down and what the XP was paid against.
    understanding: clamp(result ? result.score : reply.understanding),
    turns: !done && question ? [...state.turns, { role: 'student', text: question }] : state.turns,
    questionsLeft: done ? 0 : Math.max(0, reply.turns_remaining ?? 0),
    stuckOn: done ? null : stuckOn(state.concept, reply.targeted_misconception_id),
    done,
    result,
  }
}

/**
 * The wrong idea the student is still holding, quoted back in its own words.
 *
 * Only ever the statement — the correction is what the learner is being asked
 * to supply, and printing it here would answer the question for them.
 */
function stuckOn(concept: Concept, id: string | null | undefined): string | null {
  if (!id) return null
  const match = concept.misconceptions.find((candidate) => candidate.id === id)
  const statement = match?.statement?.trim()
  return statement ? statement : null
}

/**
 * Whether this draft can go, and what to tell the learner if not.
 *
 * Every branch mirrors a rule in `ExplainChatIn`. The 20-character floor counts
 * the learner's whole side of the conversation, not just the draft, so it only
 * ever binds on the first message.
 */
export function canSend(state: ChatState, draft: string): SendCheck {
  const said = draft.trim()
  const combined = learnerText(state.turns, said)
  const charsNeeded = Math.max(0, MIN_LEARNER_CHARS - combined.length)

  if (state.done) {
    return { ok: false, reason: 'The student is done asking. There is nothing left to send.', charsNeeded: 0 }
  }
  if (state.turns.length >= MAX_MESSAGES) {
    return { ok: false, reason: 'This conversation has run as long as it can.', charsNeeded: 0 }
  }
  if (said.length > MAX_MESSAGE_CHARS) {
    return {
      ok: false,
      reason: `That is ${said.length - MAX_MESSAGE_CHARS} characters too long. Keep each answer under ${MAX_MESSAGE_CHARS}.`,
      charsNeeded: 0,
    }
  }
  if (totalChars(state.turns) + said.length > MAX_TOTAL_CHARS) {
    return { ok: false, reason: 'This conversation has run as long as it can. Try a shorter answer.', charsNeeded: 0 }
  }
  if (!said) {
    return { ok: false, reason: null, charsNeeded }
  }
  if (charsNeeded > 0) {
    return {
      ok: false,
      reason: `${charsNeeded} more ${charsNeeded === 1 ? 'character' : 'characters'} before you can send it.`,
      charsNeeded,
    }
  }
  return { ok: true, reason: null, charsNeeded: 0 }
}

/** The comprehension meter, in words a first-year student reads without help. */
export const meterLabel = (state: ChatState): string => `The student understands: ${clamp(state.understanding)}%`

/**
 * How many more questions the student may ask, so the ending never lands out of
 * nowhere. Null before the first reply, and once the conversation is over.
 */
export function questionsLabel(state: ChatState): string | null {
  if (state.done || state.questionsLeft === null || state.questionsLeft <= 0) return null
  return `${state.questionsLeft} ${state.questionsLeft === 1 ? 'question' : 'questions'} left`
}

/** The caption under the meter: what the student has not got yet. */
export const stuckLabel = (state: ChatState): string | null =>
  state.stuckOn ? `They still believe: "${state.stuckOn}"` : null

/**
 * Which concept to open on: the first one the learner has never explained, or
 * the first one there is, so the panel always has something to teach.
 */
export function firstUnexplained(concepts: readonly Concept[], explained: ReadonlySet<string>): Concept | null {
  if (concepts.length === 0) return null
  return concepts.find((concept) => !explained.has(concept.id)) ?? concepts[0]
}
