/**
 * What the rest of the class did, reduced to the few claims that survive thin
 * data.
 *
 * `GET /servers/{id}/cohort` is a rich payload and almost all of it is a trap
 * at demo scale. With one player answering, every share it reports is either
 * 100% or 0%, the "hardest" idea is whichever one that single player got wrong,
 * and a leaderboard is a list with one name on it. All of those are
 * *structurally* valid and *diagnostically* worthless, and a screen that renders
 * them anyway is telling the room something it has not measured.
 *
 * So every derivation here comes back with the evidence attached — how many
 * people actually answered, how many are actually playing — and the components
 * refuse the claim rather than dressing it up. The two thresholds are exported
 * so they can be tuned for a demo cohort in one place.
 *
 * Purity is the same hard rule the rest of `scene/` follows: no DOM, no React,
 * no clock, no randomness, no network, and never a throw. Every field read here
 * arrived over HTTP and may be missing, null, or the wrong type.
 */

import type { CohortOut, CourseGraph, DistributionOption, SceneDistribution } from '../../api/types'
import type { ConceptProgress } from '../pedagogy'

/**
 * Answers needed on one question before a share is worth drawing.
 *
 * Two answers give 50/50 or 100/0 and read as a finding; they are not one. Three
 * is the smallest number where "most of the class" is a sentence about a class.
 */
export const MIN_ECHO_ANSWERS = 3

/**
 * People who have actually answered something before any class-level claim is
 * made. Not `members_count`: a class of thirty where only you have played is
 * still a class of one for anything measured from answers.
 */
export const MIN_CLASS_PLAYERS = 2

/** How much of the board to show before falling back to "…and your row". */
export const DEFAULT_BOARD_ROWS = 5

// ---------------------------------------------------------------------------
// Defensive readers. Everything below treats its input as untrusted JSON.
// ---------------------------------------------------------------------------

const asArray = <T,>(value: readonly T[] | undefined | null): readonly T[] =>
  Array.isArray(value) ? value : []

/** A string worth showing: present, a string, and not just whitespace. */
const text = (value: string | undefined | null): string | null => {
  if (typeof value !== 'string') return null
  return value.trim() === '' ? null : value
}

/** A count: a finite, non-negative integer, or zero. */
const count = (value: number | undefined | null): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0

/** A percentage clamped into 0-100, for the one number we take from the server. */
const percent = (value: number | undefined | null): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(100, Math.max(0, Math.round(value))) : 0

// ---------------------------------------------------------------------------
// One question, answered by everybody
// ---------------------------------------------------------------------------

/** One answer option, with how much of the class landed on it. */
export interface EchoOption {
  optionId: string
  /** The option exactly as the learner read it. */
  text: string
  correct: boolean
  count: number
  /** 0-100, recomputed from the counts on this screen so bars and copy agree. */
  pct: number
  /** This is the one the learner committed to. */
  mine: boolean
}

/** The wrong option more of the class picked than any other. */
export interface ClassTrap {
  optionId: string
  /** The option's own wording. Always present. */
  text: string
  /**
   * The same mistake as a belief, in the learner's voice, when the graph knows
   * the wrong idea behind this option. Null when it does not — and then the
   * option's wording is all there is, which is honest and enough.
   */
  belief: string | null
  count: number
  pct: number
}

export interface SceneEcho {
  sceneId: string
  /** People counted on this question (first answers only, one per person). */
  answers: number
  options: EchoOption[]
  /** Enough answers for a share to mean anything. */
  enough: boolean
  /** Null unless one wrong option beat every other outright. */
  trap: ClassTrap | null
}

/** Misconception ids are unique graph-wide, so the owning concept need not be known. */
function beliefOf(graph: CourseGraph | null | undefined, id: string | null | undefined): string | null {
  if (!id) return null
  for (const concept of asArray(graph?.concepts)) {
    for (const misconception of asArray(concept?.misconceptions)) {
      if (misconception?.id === id) return text(misconception.statement)
    }
  }
  return null
}

/** The first entry for this scene. Ids are per-world; a duplicate would be a bug, not a choice. */
function distributionFor(
  cohort: CohortOut | null | undefined,
  sceneId: string,
): SceneDistribution | null {
  if (!text(sceneId)) return null
  return asArray(cohort?.distribution).find((entry) => entry?.scene_id === sceneId) ?? null
}

/**
 * How the class answered one question.
 *
 * Returns null when there is nothing to say at all — no payload, no entry for
 * this scene, or an entry nobody is counted in. `enough` separates "we have
 * numbers" from "the numbers mean something"; the caller must respect it.
 *
 * Shares are recomputed from the counts rather than taken from `pct`, so the
 * bars always add up to the "N answers" line printed beside them. The server
 * rounds against its own total, and two roundings that disagree on screen look
 * like a bug in the data.
 */
export function sceneEcho(
  cohort: CohortOut | null | undefined,
  sceneId: string,
  options?: { chosenOptionId?: string | null; graph?: CourseGraph | null },
): SceneEcho | null {
  const entry = distributionFor(cohort, sceneId)
  if (!entry) return null

  const raw = asArray(entry.options).filter((option) => option && text(option.option_id) && text(option.text))
  const answers = raw.reduce((sum, option) => sum + count(option.count), 0)
  if (answers <= 0) return null

  const chosenId = options?.chosenOptionId ?? null
  const echoed: EchoOption[] = raw.map((option) => {
    const c = count(option.count)
    return {
      optionId: option.option_id,
      text: option.text,
      correct: option.correct === true,
      count: c,
      pct: Math.round((c / answers) * 100),
      mine: chosenId !== null && option.option_id === chosenId,
    }
  })

  return {
    sceneId,
    answers,
    options: echoed,
    enough: answers >= MIN_ECHO_ANSWERS,
    trap: topTrap(raw, echoed, options?.graph ?? null),
  }
}

/**
 * The wrong option the class fell for.
 *
 * Only a strict winner counts. On a tie there is no "most of the class", and
 * saying so anyway would be inventing a finding out of a coin flip.
 */
function topTrap(
  raw: readonly DistributionOption[],
  echoed: readonly EchoOption[],
  graph: CourseGraph | null,
): ClassTrap | null {
  const wrong = echoed.filter((option) => !option.correct && option.count > 0)
  if (wrong.length === 0) return null

  const sorted = [...wrong].sort((a, b) => b.count - a.count)
  if (sorted.length > 1 && sorted[0].count === sorted[1].count) return null

  const winner = sorted[0]
  const source = raw.find((option) => option.option_id === winner.optionId)
  return {
    optionId: winner.optionId,
    text: winner.text,
    belief: beliefOf(graph, source?.misconception_id),
    count: winner.count,
    pct: winner.pct,
  }
}

// ---------------------------------------------------------------------------
// The class, at the end of a run
// ---------------------------------------------------------------------------

/** One row of the board, already resolved against who is reading it. */
export interface BoardRow {
  rank: number
  userId: string
  name: string
  xp: number
  /** This row is the reader's. */
  mine: boolean
}

export interface ClassSnapshot {
  /** Everybody on the server, whether or not they have played. */
  membersCount: number
  /** People with at least one recorded answer. The honest denominator. */
  playersCount: number
  /** First answers counted across every ready world of this class. */
  answersCount: number
  /** Enough people have played for a class-level claim to be about a class. */
  enough: boolean
  /**
   * The idea the class got wrong most often, when enough of them have played.
   * Null when the server has nothing (`hardest_concept` is null until somebody
   * answers) *and* when the data is too thin to name one honestly.
   */
  hardest: { label: string; wrongPct: number } | null
  /** The top of the board, capped. */
  rows: BoardRow[]
  /** The reader's row when it falls outside the cap; null when it is in `rows` or unknown. */
  myRow: BoardRow | null
  /** How many people the board has in total, so "top 5 of 12" can be said. */
  rankedCount: number
}

/**
 * The class, as much of it as is true.
 *
 * `me` is null for anyone with no recorded attempt even though they still
 * appear in `entries`, so "which row is mine" is resolved from `me.user_id`
 * only — never guessed from a display name, which is not unique.
 */
export function classSnapshot(
  cohort: CohortOut | null | undefined,
  options?: { limit?: number },
): ClassSnapshot | null {
  if (!cohort || typeof cohort !== 'object') return null

  const limit = Math.max(1, options?.limit ?? DEFAULT_BOARD_ROWS)
  const entries = asArray(cohort.entries).filter((entry) => entry && text(entry.user_id))
  const myId = text(cohort.me?.user_id ?? null)

  const board: BoardRow[] = entries.map((entry, index) => ({
    rank: count(entry.rank) || index + 1,
    userId: entry.user_id,
    name: text(entry.display_name) ?? 'Someone',
    xp: count(entry.xp),
    mine: myId !== null && entry.user_id === myId,
  }))

  const playersCount = entries.filter((entry) => count(entry.attempts) > 0).length
  const answersCount = count(cohort.predictions_made)
  const enough = playersCount >= MIN_CLASS_PLAYERS && answersCount >= MIN_ECHO_ANSWERS

  const rows = board.slice(0, limit)
  const myRow = board.find((row) => row.mine) ?? null

  const hardestLabel = text(cohort.hardest_concept?.label ?? null)

  return {
    membersCount: count(cohort.members_count),
    playersCount,
    answersCount,
    enough,
    hardest:
      enough && hardestLabel
        ? { label: hardestLabel, wrongPct: percent(cohort.hardest_concept?.wrong_pct) }
        : null,
    rows,
    myRow: myRow && !rows.some((row) => row.mine) ? myRow : null,
    rankedCount: board.length,
  }
}

// ---------------------------------------------------------------------------
// What the learner actually got right
// ---------------------------------------------------------------------------

export interface MasterySummary {
  /** Every question on this idea answered correctly. */
  mastered: ConceptProgress[]
  /** Walked, but something on it is still wrong or unanswered. */
  practised: ConceptProgress[]
  /** Never opened. */
  untouched: ConceptProgress[]
  total: number
}

/**
 * Split the concept trail into what was mastered and what was not.
 *
 * This decides nothing: `state` is `conceptTrail`'s verdict, and that verdict
 * only means "answered correctly" when the trail was built with its
 * `correctSceneIds` argument. Built without it, `mastered` silently degrades to
 * "walked every scene", which on a closing screen is the one lie this product
 * cannot tell. Callers must pass the fourth argument; there is no way to detect
 * from here that they did not.
 */
export function masterySummary(trail: readonly ConceptProgress[] | null | undefined): MasterySummary {
  const entries = asArray(trail).filter((entry) => entry && entry.concept && text(entry.concept.id))
  return {
    mastered: entries.filter((entry) => entry.state === 'mastered'),
    practised: entries.filter((entry) => entry.state === 'in_progress'),
    untouched: entries.filter((entry) => entry.state !== 'mastered' && entry.state !== 'in_progress'),
    total: entries.length,
  }
}
