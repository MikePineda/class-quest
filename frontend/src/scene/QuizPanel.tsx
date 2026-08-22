/**
 * The quiz gate: the gauntlet, played one question at a time.
 *
 * This panel invents nothing. The questions are `games.gauntlet` exactly as the
 * generator wrote them, the teaching sequence is the same
 * `PredictionStage -> DiagnosisStage -> EvidenceStage` the map overlay uses, and
 * the grading is the server's. What it adds is only the shape of a quiz: an
 * index, a score, and a threshold.
 *
 * Two things are deliberate and worth not "fixing":
 *
 * - **Committing is a separate button.** Clicking an option never advances.
 *   Owning the guess before being corrected is the whole pedagogical claim; an
 *   auto-advancing click turns the diagnosis into trivia feedback.
 * - **The attempt is posted with `archetype: 'gauntlet'`**, by the shared commit
 *   path in `WorldExperience`. These scene ids live in the gauntlet game, not
 *   the quest, and the server looks the scene up by `(world, archetype,
 *   scene_id)` — naming the wrong archetype grades against a scene that does not
 *   exist.
 *
 * Nothing here is persisted locally: every outcome comes from the session in
 * `WorldExperience` (this render's commits) or from `GET /progress` (previous
 * sessions), which is why closing the gate mid-quiz loses nothing.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CourseGraph, Game, Option, PredictionScene, SceneProgress } from '../api/types'
import { diagnose } from './pedagogy'
import { DiagnosisStage, EvidenceStage, filled, Insight, PredictionStage } from './SceneStages'
import type { SceneOutcome, Stage } from './SceneStages'

/**
 * Four correct in five, rounded up, and never zero.
 *
 * The rounding is not a detail: on a three-question gauntlet `ceil(0.8 * 3)` is
 * 3, so the gate demands a clean sweep. That is why every string below quotes
 * the threshold as a count of questions instead of promising "80%" — the
 * percentage would be a promise the arithmetic does not keep.
 *
 * The threshold itself is client-side and cosmetic: correctness is graded and
 * stored by the server, but *clearing a gate* is a browser-side idea and no XP,
 * leaderboard position or teacher-facing number may ever depend on it. When
 * `gating.ts` lands it owns this constant and this file imports it.
 */
const QUIZ_PASS_RATIO = 0.8
const passMark = (total: number) => Math.max(1, Math.ceil(QUIZ_PASS_RATIO * total))

export interface QuizPanelProps {
  /** The gauntlet game. Its prediction scenes are the questions. */
  gauntlet: Game
  /** Where misconceptions and verified quotes live. Null degrades, never throws. */
  graph: CourseGraph | null
  /** Commits made in this session, keyed by scene id. */
  outcomes: Record<string, SceneOutcome>
  /** Server-side history from a previous session, keyed by scene id. */
  restored: Record<string, SceneProgress>
  /** An attempt is in flight; the commit button locks. */
  committing: boolean
  /** The shared commit path: posts the attempt, grades it, updates the session. */
  onCommit: (scene: PredictionScene, option: Option) => void
  /** Forget these commits so the questions can be answered again. */
  onRetry: (sceneIds: readonly string[]) => void
  onClose: () => void
}

export function QuizPanel({
  gauntlet,
  graph,
  outcomes,
  restored,
  committing,
  onCommit,
  onRetry,
  onClose,
}: QuizPanelProps) {
  /**
   * Chapters are a layout idea the quiz does not need: the gauntlet is one
   * timed run, so its scenes flatten to a single question list. Non-prediction
   * scenes are dropped rather than rendered — a dialogue scene has no answer to
   * grade and would silently count against the score.
   */
  const questions = useMemo(
    () =>
      gauntlet.chapters
        .flatMap((chapter) => chapter.scenes)
        .filter((scene): scene is PredictionScene => scene.type === 'prediction'),
    [gauntlet],
  )

  /**
   * Previous sessions, re-diagnosed rather than merely counted.
   *
   * `SceneProgress` carries the option the learner chose, so the meaning of the
   * old answer is fully recoverable: `diagnose` rebuilds the misconception and
   * the source quote from the graph. Grading is offline here (from
   * `Option.correct`, the same flag the server grades on) because the verdict
   * being reconstructed belongs to the *chosen option*, and `best_correct` is
   * the best of all attempts, which is a different claim.
   *
   * No XP is attributed: the reward was paid on the original attempt, and this
   * is only its record.
   */
  const restoredOutcomes = useMemo(() => {
    const byScene: Record<string, SceneOutcome> = {}
    for (const question of questions) {
      const chosenId = restored[question.id]?.chosen_option_id
      if (!chosenId) continue
      const option = question.options.find((candidate) => candidate.id === chosenId)
      if (!option) continue
      byScene[question.id] = {
        optionId: option.id,
        diagnosis: diagnose(graph, question, option),
        xpAwarded: null,
        persistence: 'saved',
      }
    }
    return byScene
  }, [questions, restored, graph])

  const outcomeOf = useCallback(
    (question: PredictionScene): SceneOutcome | null =>
      outcomes[question.id] ?? restoredOutcomes[question.id] ?? null,
    [outcomes, restoredOutcomes],
  )

  // Open on the first unanswered question: a learner coming back should not
  // have to click past what they already did. All answered opens on the score.
  const [index, setIndex] = useState(() => {
    const first = questions.findIndex((question) => !(outcomes[question.id] ?? restoredOutcomes[question.id]))
    return first === -1 ? questions.length : first
  })
  /**
   * Null means "whatever this question deserves": unanswered opens on the
   * prediction, already answered opens on its diagnosis. That default is what
   * makes a restored question come back as a correction the learner can read
   * again rather than as a quiz locked against them, and it keeps working when
   * `GET /progress` lands after the panel is already open.
   */
  const [stage, setStage] = useState<Stage | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const graded = useMemo(
    () => questions.map((question) => ({ question, outcome: outcomeOf(question) })),
    [questions, outcomeOf],
  )

  const total = questions.length
  const rightCount = graded.filter((entry) => entry.outcome?.diagnosis.correct === true).length
  const missed = graded.filter(
    (entry): entry is { question: PredictionScene; outcome: SceneOutcome } =>
      entry.outcome !== null && !entry.outcome.diagnosis.correct,
  )
  const firstUnanswered = graded.findIndex((entry) => entry.outcome === null)
  const unanswered = graded.filter((entry) => entry.outcome === null).length

  const question = index < total ? questions[index] : null
  const outcome = question ? outcomeOf(question) : null
  const activeStage: Stage = stage ?? (outcome ? 'diagnosis' : 'prediction')

  const goTo = useCallback((next: number) => {
    setIndex(next)
    setStage(null)
    setSelectedId(null)
  }, [])

  /**
   * Stay on the prediction after committing. `PredictionStage` then shows the
   * locked options with the verdict on them and its own "Inspect the result"
   * button — the beat where the learner sees what they chose before they are
   * told what it means.
   */
  const commit = useCallback(
    (scene: PredictionScene, option: Option) => {
      setStage('prediction')
      onCommit(scene, option)
    },
    [onCommit],
  )

  const retryMissed = useCallback(() => {
    const ids = missed.map((entry) => entry.question.id)
    if (ids.length === 0) return
    onRetry(ids)
    const first = questions.findIndex((candidate) => candidate.id === ids[0])
    setIndex(first === -1 ? 0 : first)
    setStage('prediction')
    setSelectedId(null)
  }, [missed, onRetry, questions])

  /**
   * Number keys select an option. Selection only — committing stays a
   * deliberate second act, so a stray keypress can never answer a question.
   */
  useEffect(() => {
    if (!question || outcome || activeStage !== 'prediction') return
    const options = question.options
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target
      if (target instanceof Element && target.closest('input, textarea, select')) return
      const slot = Number(event.key)
      if (!Number.isInteger(slot) || slot < 1 || slot > options.length) return
      event.preventDefault()
      setSelectedId(options[slot - 1].id)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [question, outcome, activeStage])

  // A gauntlet with no prediction scenes is possible (the schema allows a game
  // of dialogue). Saying so beats an empty quiz that looks broken.
  if (total === 0) {
    return (
      <div>
        <p className="leading-7 text-ink-muted">
          This gauntlet generated no questions, so there is nothing to answer here yet. Regenerate the world to get a
          new one.
        </p>
        <button className="button-primary mt-6" onClick={onClose}>
          Back to the hub
        </button>
      </div>
    )
  }

  const evidence = outcome?.diagnosis.evidence ?? null
  const hasEvidence = Boolean(evidence && filled(evidence.quote))
  const isLast = index === total - 1
  const advanceLabel = isLast ? 'See your score' : 'Next question'
  const advance = () => goTo(index + 1)

  return (
    <div>
      {/* Where you are, what you have, and a way back to any question. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3 border-b border-white/10 pb-5">
        <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-ink-muted">
          {question ? `Question ${index + 1} of ${total}` : 'Your score'}
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          {graded.map((entry, slot) => {
            const current = slot === index
            const answered = entry.outcome !== null
            const right = entry.outcome?.diagnosis.correct === true
            const tone = current
              ? 'border-secondary bg-secondary/20 text-secondary'
              : right
                ? 'border-secondary/40 bg-secondary/10 text-secondary'
                : answered
                  ? 'border-primary/40 bg-primary/10 text-primary-soft'
                  : 'border-white/12 bg-surface-high text-ink-muted hover:border-white/30'
            return (
              <button
                key={entry.question.id}
                type="button"
                className={`h-7 w-7 rounded-lg border font-mono text-xs font-bold transition ${tone}`}
                aria-current={current}
                aria-label={`Question ${slot + 1}${answered ? (right ? ', correct' : ', wrong') : ', unanswered'}`}
                onClick={() => goTo(slot)}
              >
                {slot + 1}
              </button>
            )
          })}
        </div>
        <p className="ml-auto text-xs font-bold text-secondary" aria-live="polite">
          {rightCount} / {total} correct
        </p>
      </div>

      <div className="mt-6">
        {question === null ? (
          <div className="stage-enter">
            <p className="eyebrow">Gauntlet run complete</p>
            <h3 className="mt-3 text-3xl font-black text-ink sm:text-4xl">
              {rightCount} <span className="text-ink-muted">/ {total}</span>
            </h3>
            <p className={`mt-2 text-sm font-bold ${rightCount >= passMark(total) ? 'text-secondary' : 'text-primary-soft'}`}>
              {rightCount >= passMark(total) ? 'Gate cleared.' : 'Gate not cleared yet.'}
            </p>
            <p className="mt-3 text-sm leading-6 text-ink-muted">
              This gate opens at {passMark(total)} of {total} correct
              {passMark(total) === total ? ' — at this length the threshold is every question' : ''}.
              {rightCount >= passMark(total)
                ? ''
                : ` ${passMark(total) - rightCount} more ${passMark(total) - rightCount === 1 ? 'answer' : 'answers'} to go.`}
            </p>
            {unanswered > 0 && (
              <p className="mt-2 text-sm leading-6 text-ink-muted">
                {unanswered} {unanswered === 1 ? 'question is' : 'questions are'} still unanswered.
              </p>
            )}

            {missed.length > 0 ? (
              <div className="mt-7 space-y-4">
                <p className="eyebrow text-ink-muted">The beliefs you committed to</p>
                {missed.map((entry) => (
                  <MissedQuestion key={entry.question.id} question={entry.question} outcome={entry.outcome} />
                ))}
              </div>
            ) : (
              rightCount > 0 && (
                <p className="mt-7 leading-7 text-ink">
                  Nothing to correct: every question you committed to, you got right.
                </p>
              )
            )}

            <div className="mt-7 flex flex-wrap items-center gap-3">
              {missed.length > 0 && (
                <button className="button-primary" onClick={retryMissed}>
                  Retry the {missed.length === 1 ? 'question' : `${missed.length} questions`} you missed
                </button>
              )}
              {unanswered > 0 && firstUnanswered !== -1 && (
                <button className="button-secondary" onClick={() => goTo(firstUnanswered)}>
                  Answer the {unanswered === 1 ? 'one you skipped' : `${unanswered} you skipped`}
                </button>
              )}
              <button className={missed.length > 0 ? 'button-secondary' : 'button-primary'} onClick={onClose}>
                Back to the hub
              </button>
            </div>
          </div>
        ) : outcome && activeStage === 'diagnosis' ? (
          <DiagnosisStage
            key={question.id}
            diagnosis={outcome.diagnosis}
            onContinue={hasEvidence ? () => setStage('evidence') : advance}
            continueLabel={hasEvidence ? 'Open verified evidence' : advanceLabel}
          />
        ) : outcome && activeStage === 'evidence' && evidence && hasEvidence ? (
          <div key={question.id}>
            <EvidenceStage
              quote={evidence.quote}
              segment={evidence.segment_id}
              title={outcome.diagnosis.sourceTitle}
              onContinue={onClose}
            />
            <button className="button-primary mt-4" onClick={advance}>
              {advanceLabel}
            </button>
          </div>
        ) : (
          <div key={question.id}>
            <PredictionStage
              scene={question}
              outcome={outcome}
              selectedId={selectedId}
              committing={committing}
              onSelect={setSelectedId}
              onCommit={commit}
              onContinue={() => setStage('diagnosis')}
            />
            {!outcome && (
              <p className="mt-5 text-xs font-semibold text-ink-muted">
                Keys <kbd className="font-mono text-ink">1</kbd>–
                <kbd className="font-mono text-ink">{question.options.length}</kbd> pick an option, in the order shown.
                Committing is a separate step.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * One wrong answer on the score card.
 *
 * Every line here is content that was generated or extracted. When there is no
 * misconception and no reveal, that absence is stated instead of papered over:
 * a plausible sentence written by the client is indistinguishable from grounded
 * content, and that is the one thing this product cannot afford to blur.
 */
function MissedQuestion({ question, outcome }: { question: PredictionScene; outcome: SceneOutcome }) {
  const misconception = outcome.diagnosis.misconception
  const belief = misconception && filled(misconception.statement) ? misconception.statement : null
  const correction = misconception && filled(misconception.correction) ? misconception.correction : null

  return (
    <div className="rounded-xl border border-white/10 bg-background/40 p-5">
      <p className="text-sm font-bold leading-6 text-ink">{question.prompt}</p>
      {belief && (
        <div className="mt-3">
          <Insight label="The belief you committed to" text={belief} tone="amber" />
        </div>
      )}
      {correction && (
        <div className="mt-3">
          <Insight label="What is true instead" text={correction} tone="teal" />
        </div>
      )}
      {!belief && !correction && (
        <p className="mt-3 leading-7 text-ink-muted">
          {filled(outcome.diagnosis.reveal)
            ? outcome.diagnosis.reveal
            : 'No misconception was recorded for the option you chose, and this question carries no written explanation.'}
        </p>
      )}
    </div>
  )
}
