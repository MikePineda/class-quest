/**
 * Which portals of a world count as cleared.
 *
 * ## How much of this is real — read before you build on it
 *
 * The server has no concept of a cleared portal. `ProgressOut` and `MyProgress`
 * carry attempts, `best_correct`, XP and explanation verdicts, and nothing else;
 * there is no portal state on the wire and nothing server-side refuses anything
 * because a portal is unclear. Clearing is decided here, in the browser, and it
 * is worth exactly what that implies.
 *
 * Portal by portal:
 *
 * - **Storybook** is a client-only read receipt. `readConceptIds` never leaves
 *   the browser and asserts nothing about understanding — it records that a
 *   panel was opened.
 * - **Quiz correctness is real; the threshold is not.** Every id in
 *   `correctSceneIds` came from `AttemptOut.correct`, graded server-side against
 *   the stored game — the client never sends `correct` and never grades — and it
 *   survives a reload through `SceneProgress.best_correct`. But the comparison
 *   against `quizThreshold` runs here. Correctness is also sticky and best-of, so
 *   a learner can retry until they pass; that is a deliberate pedagogical choice,
 *   not a hole.
 * - **Explain is the only honest one.** Its clear condition is fully
 *   reconstructible from `ProgressOut.explanations[]`, which the server wrote.
 *
 * The consequence, and it is the part that matters: **no XP, no leaderboard
 * position and no teacher-facing analytic may sit behind a portal clear in this
 * version.** XP comes only from server-issued `xp_awarded`. Clearing is a
 * cosmetic progression signal for the player in front of the screen. The day it
 * needs to mean more, it becomes a server field — a backend change, not an edit
 * to this file.
 *
 * Purity is a hard rule: no DOM, no React, no clock, no randomness, no network.
 * So is never throwing. Everything here is derived from HTTP payloads, and an
 * exception thrown while the hub renders blanks the world.
 */

/** Share of a gauntlet a learner must get right. Copy says "N of M", never "80%". */
export const QUIZ_PASS_RATIO = 0.8

export interface ClearInput {
  /** Every concept the world teaches. */
  conceptIds: readonly string[]
  /** Concepts whose storybook panel has been opened. Client-only. */
  readConceptIds: ReadonlySet<string>
  /** Every gauntlet scene in the world. */
  quizSceneIds: readonly string[]
  /** Scenes the server has ever graded correct (`best_correct`). */
  correctSceneIds: ReadonlySet<string>
  /** Concepts with a server-recorded explanation. */
  explainedConceptIds: ReadonlySet<string>
}

export interface ClearState {
  storybook: boolean
  quiz: boolean
  explain: boolean
  /** Reserved for the sealed portal, which no version of this game can open yet. */
  sealed: false
}

/** A `ReadonlySet` that arrived over a boundary may be anything. Ask it politely. */
function has(set: ReadonlySet<string> | undefined | null, id: string): boolean {
  return typeof set?.has === 'function' && set.has(id)
}

/** Same for the lists: a missing array is an empty one, never a throw. */
function ids(list: readonly string[] | undefined | null): readonly string[] {
  return Array.isArray(list) ? list : []
}

/**
 * Correct answers needed to clear a gauntlet of `questionCount` questions:
 * `max(1, ceil(0.8n))`. At n=3 that rounds to 3 of 3, which is why the UI states
 * the raw count instead of the ratio.
 *
 * At n=0 it returns 1 — one correct answer out of no questions, unreachable by
 * construction, so an empty gauntlet can never clear.
 */
export function quizThreshold(questionCount: number): number {
  const n = Number.isFinite(questionCount) ? Math.max(0, Math.floor(questionCount)) : 0
  return Math.max(1, Math.ceil(QUIZ_PASS_RATIO * n))
}

/**
 * Derive the clear state of every portal. Total: any shape of input produces a
 * `ClearState`, and an unknown input clears nothing.
 */
export function clearedPortals(input: ClearInput): ClearState {
  const concepts = ids(input?.conceptIds)
  const questions = ids(input?.quizSceneIds)

  const storybook =
    concepts.length > 0 && concepts.every((id) => has(input?.readConceptIds, id))

  // Only ids that are actually questions in this world count; a correct answer
  // recorded against some other scene must not push the gauntlet over the line.
  const correct = questions.filter((id) => has(input?.correctSceneIds, id)).length
  const quiz = correct >= quizThreshold(questions.length)

  const explain = concepts.some((id) => has(input?.explainedConceptIds, id))

  return { storybook, quiz, explain, sealed: false }
}

/** The world is cleared when all three openable portals are. `sealed` never counts. */
export function worldCleared(state: ClearState): boolean {
  return Boolean(state?.storybook && state?.quiz && state?.explain)
}
