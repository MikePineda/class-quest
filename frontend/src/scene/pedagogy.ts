/**
 * The teaching brain of a scene: what the learner just got wrong, why it was
 * tempting, what is actually true, and the sentence from their own material
 * that settles it.
 *
 * The renderer only ever had `scene.reveal`, which is the same paragraph for
 * everyone in the room. The pedagogical claim of ClassQuest lives one level
 * deeper: the learner predicts, commits, and is then told *which specific wrong
 * belief they hold*. That diagnosis is deliberately split across two payloads
 * (see `schema/README.md`, "Why the fields are shaped this way"):
 *
 * - The **server** grades. `POST /worlds/{id}/attempts` returns `AttemptOut`
 *   with `correct` and a trimmed `misconception` — that verdict is authority on
 *   correctness, because the client never sends `correct` and never should.
 * - The **graph** explains. `Concept.misconceptions[]` carries the third part
 *   the wire format drops, `why_plausible`, and `Concept.source_spans[]` carries
 *   the verbatim `quote` that exists nowhere in the game or the attempt reply.
 *
 * So neither side alone can render the three-part diagnosis plus evidence.
 * This module merges them, and it merges them offline too: with the bundled
 * fixture world there is a graph and no API at all, so it grades locally from
 * `Option.correct` and still produces the complete diagnosis.
 *
 * Purity is a hard rule here — no DOM, no React, no clock, no randomness, no
 * network — and so is *never throwing*. Every input arrived over HTTP; a
 * dangling `concept_id` or a missing `misconceptions` array must degrade to a
 * null field, because an exception thrown mid-scene blanks the screen and there
 * is no second take during a live demo.
 */

import type {
  AttemptOut,
  Concept,
  CourseGraph,
  Game,
  Misconception,
  Option,
  Scene,
  SourceSpan,
} from '../api/types'

export interface Diagnosis {
  correct: boolean
  /** The concept the scene teaches, resolved from the graph. Null if unresolvable. */
  concept: Concept | null
  /** The wrong belief the learner just demonstrated. Null when correct, or unresolvable. */
  misconception: Misconception | null
  /** Verbatim quote from the learner's own material that settles it. Null if none. */
  evidence: SourceSpan | null
  /** Title of the uploaded source, for citing the evidence. */
  sourceTitle: string | null
  /** Shown whatever the learner chose. Prefers the server's copy over the game's. */
  reveal: string
}

export interface ConceptProgress {
  concept: Concept
  /** Scenes in the game that teach this concept. */
  total: number
  done: number
  state: 'locked' | 'available' | 'in_progress' | 'mastered'
}

// ---------------------------------------------------------------------------
// Defensive readers. Everything below treats its input as untrusted JSON.
// ---------------------------------------------------------------------------

const asArray = <T,>(value: readonly T[] | undefined | null): readonly T[] =>
  Array.isArray(value) ? value : []

/** A string that is worth showing: present, a string, and not just whitespace. */
const text = (value: string | undefined | null): string | null => {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? null : value
}

/** Dialogue scenes teach no concept; prediction and simulation scenes carry one. */
function conceptIdOf(scene: Scene | null | undefined): string | null {
  if (!scene || typeof scene !== 'object') return null
  return 'concept_id' in scene ? text(scene.concept_id) : null
}

/** Only prediction scenes have a reveal of their own. */
function sceneReveal(scene: Scene | null | undefined): string | null {
  if (!scene || typeof scene !== 'object') return null
  return 'reveal' in scene ? text(scene.reveal) : null
}

function findConcept(graph: CourseGraph | null | undefined, conceptId: string | null): Concept | null {
  if (!conceptId) return null
  return asArray(graph?.concepts).find((concept) => concept?.id === conceptId) ?? null
}

/** Misconception ids are unique graph-wide, so the owning concept need not be known. */
function findMisconception(
  graph: CourseGraph | null | undefined,
  id: string | null | undefined,
): Misconception | null {
  if (!id) return null
  for (const concept of asArray(graph?.concepts)) {
    const hit = asArray(concept?.misconceptions).find((misconception) => misconception?.id === id)
    if (hit) return hit
  }
  return null
}

/**
 * The wrong belief, preferring the graph because only the graph has
 * `why_plausible`. The verdict's own misconception id is tried against the
 * graph too: a repeat attempt can be graded server-side against an option this
 * client did not render, and the richer copy is still the one worth showing.
 *
 * Resolution is **graph-wide, not scoped to the scene's concept**, because the
 * contract is graph-wide: `schema/README.md` promises only that "every
 * `concept_id` and `misconception_id` in a game resolves in the graph". A
 * scene may legitimately offer a distractor owned by a neighbouring concept —
 * "regression is just classification with numbers", offered on a classification
 * scene — and those boundary confusions are the most diagnostic distractors the
 * planner writes. Scoping to the scene's concept enforced an invariant nobody
 * promised and dropped one incorrect option in three on real generated content,
 * which meant a third of wrong answers taught nothing.
 *
 * `concept` and `evidence` deliberately do NOT follow the misconception to its
 * owning concept: the scene teaches its own concept and `reveal` explains that
 * one, so its quote is the right grounding. The cross-concept part of the story
 * is carried by the misconception's own `correction`.
 */
function resolveMisconception(
  graph: CourseGraph | null | undefined,
  option: Option | null | undefined,
  verdict: AttemptOut | null | undefined,
): Misconception | null {
  for (const id of [option?.misconception_id, verdict?.misconception?.id]) {
    const hit = findMisconception(graph, id)
    if (hit) return hit
  }

  // Offline the graph is all there is; online without a graph the verdict is.
  // `why_plausible` is left empty rather than invented: an LLM-shaped sentence
  // written by the client would be indistinguishable from grounded content.
  const fromVerdict = verdict?.misconception
  if (fromVerdict && text(fromVerdict.id)) {
    return {
      id: fromVerdict.id,
      statement: text(fromVerdict.statement) ?? '',
      why_plausible: '',
      correction: text(fromVerdict.correction) ?? '',
    }
  }
  return null
}

/**
 * Merge the server's verdict (if any) with the graph into one renderable
 * diagnosis. Call it with `verdict` omitted to grade offline from the option.
 */
export function diagnose(
  graph: CourseGraph | null,
  scene: Scene,
  option: Option,
  verdict?: AttemptOut | null,
): Diagnosis {
  const concept = findConcept(graph, conceptIdOf(scene))
  // The server grades; the option's own flag is the offline fallback only.
  const correct = verdict ? verdict.correct === true : option?.correct === true
  const spans = asArray(concept?.source_spans)

  return {
    correct,
    concept,
    misconception: correct ? null : resolveMisconception(graph, option, verdict),
    evidence: spans[0] ?? null,
    sourceTitle: text(graph?.source?.title),
    reveal: text(verdict?.reveal) ?? sceneReveal(scene) ?? '',
  }
}

// ---------------------------------------------------------------------------
// Trail
// ---------------------------------------------------------------------------

/**
 * Scene counts per concept for one game. Dialogue scenes teach nothing and are
 * skipped. `asked` and `answered` count prediction scenes only: they are the
 * ones a learner can be wrong about, so they are the ones mastery is judged on.
 */
function sceneCounts(
  game: Game | null | undefined,
  completedSceneIds: ReadonlySet<string>,
  correctSceneIds: ReadonlySet<string> | null | undefined,
) {
  const total = new Map<string, number>()
  const done = new Map<string, number>()
  const asked = new Map<string, number>()
  const answered = new Map<string, number>()
  const bump = (counter: Map<string, number>, key: string) => counter.set(key, (counter.get(key) ?? 0) + 1)

  for (const chapter of asArray(game?.chapters)) {
    for (const scene of asArray(chapter?.scenes)) {
      const conceptId = conceptIdOf(scene)
      if (!conceptId) continue
      bump(total, conceptId)
      const sceneId = text(scene?.id)
      if (sceneId && completedSceneIds?.has(sceneId)) bump(done, conceptId)
      if (scene?.type !== 'prediction') continue
      bump(asked, conceptId)
      if (sceneId && correctSceneIds?.has(sceneId)) bump(answered, conceptId)
    }
  }
  return { total, done, asked, answered }
}

/**
 * The concept graph as a progress trail, in the graph's own order (which the
 * schema guarantees is prerequisite-respecting).
 *
 * `done` counts scenes walked; mastery additionally requires that every
 * prediction for the concept is in `correctSceneIds`, so a concept answered
 * wrong reads `in_progress` and unlocks nothing downstream.
 *
 * A concept the current game happens not to cover still appears, with
 * `total: 0` — the quest and the gauntlet are two games over one graph, so a
 * concept missing from this game is a fact about the game, not about the
 * learner, and hiding it would make the trail lie about the course.
 *
 * Two things never gate, for the same reason: the trail exists to tell the
 * learner what to do next, so a lock they cannot open by playing is worse than
 * no lock at all.
 *
 * - A prerequisite id that is not in the graph. One dangling id would otherwise
 *   lock the whole trail behind a concept that does not exist.
 * - A prerequisite this game does not teach (`total === 0`). The quest and the
 *   gauntlet are two games over one graph, so a concept with no scenes here is
 *   one the learner cannot act on from inside this world; gating behind it
 *   produces a permanent lock. In the fixture quest that rule alone would dim
 *   the world's own headline concept, `overfitting`, from the first frame.
 *
 * Not gating is fixed here, in the gate. Those concepts are NOT marked
 * `mastered` to make the arithmetic work: they appear on the trail with
 * `total: 0` and a state they have actually earned, because the trail is the
 * course map and must not claim progress the learner never made.
 */
export function conceptTrail(
  graph: CourseGraph | null,
  game: Game,
  completedSceneIds: ReadonlySet<string>,
  correctSceneIds?: ReadonlySet<string>,
): ConceptProgress[] {
  const concepts = asArray(graph?.concepts).filter(
    (concept): concept is Concept => !!concept && typeof concept.id === 'string',
  )
  const { total, done, asked, answered } = sceneCounts(game, completedSceneIds, correctSceneIds)

  // Mastery does not depend on any other concept, so it is settled first and
  // the gate below can then read it in any order.
  const mastered = new Map<string, boolean>()
  for (const concept of concepts) {
    const t = total.get(concept.id) ?? 0
    const walked = t > 0 && (done.get(concept.id) ?? 0) === t
    // Walking every scene is not mastery. Without `correctSceneIds` the caller
    // has no verdicts to offer and the old meaning is kept, but when it is given
    // every prediction for the concept must have been answered correctly:
    // "Mastered" over a concept the learner got wrong is the one lie a tool
    // built to diagnose misconceptions cannot afford to tell.
    const right = !correctSceneIds || (answered.get(concept.id) ?? 0) === (asked.get(concept.id) ?? 0)
    mastered.set(concept.id, walked && right)
  }

  return concepts.map((concept) => {
    const t = total.get(concept.id) ?? 0
    const d = done.get(concept.id) ?? 0
    // A prerequisite gates only if this game actually teaches it and it is not
    // yet mastered. Unknown ids and untaught concepts are satisfied by default.
    const blocked = asArray(concept.prerequisites).some(
      (id) => mastered.has(id) && (total.get(id) ?? 0) > 0 && mastered.get(id) !== true,
    )

    let state: ConceptProgress['state']
    if (mastered.get(concept.id) === true) state = 'mastered'
    // Work already done outranks the gate: a learner mid-concept is not locked.
    else if (d > 0) state = 'in_progress'
    else if (blocked) state = 'locked'
    else state = 'available'

    return { concept, total: t, done: d, state }
  })
}
