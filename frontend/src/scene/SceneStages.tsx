/**
 * The panels that render one scene's content.
 *
 * They are deliberately independent of how the player reached that scene: they
 * take a scene, what was committed on it, and callbacks, and nothing else. No
 * canvas, no player, no load machine, no session. That is what lets a portal
 * panel and the map overlay show the same scene without either one
 * reimplementing the teaching loop.
 *
 * Every string in here is read by a first-year student who has never seen our
 * schema. Field names (`prediction`, `misconception`, `source_span`) and
 * archetype names (`gauntlet`) stay in the code and out of the screen.
 */

import type { ReactNode } from 'react'
import type { Option, PredictionScene } from '../api/types'
import type { Diagnosis } from './pedagogy'

/** `mentor_owl` -> `Mentor owl`. The enums are the label; there is no second table to drift. */
export const humanise = (value: string) => {
  const words = value.replace(/_/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** Whitespace-only strings are missing data, not content: never render a panel for one. */
export const filled = (value: string | null | undefined): value is string =>
  typeof value === 'string' && value.trim() !== ''

/** Where the committed answer ended up. Only `saved` may claim XP was awarded. */
export type Persistence = 'saved' | 'failed' | 'offline'

/** What the learner committed to on one scene, and what they were told back. */
export interface SceneOutcome {
  optionId: string
  diagnosis: Diagnosis
  /** What the server awarded for this commit. Null when nothing was recorded. */
  xpAwarded: number | null
  persistence: Persistence
}

/** The overlay is staged so the learner commits before being taught. */
export type Stage = 'prediction' | 'diagnosis' | 'evidence'

/** A quote lifted from the learner's own upload, ready to render. */
export interface SourceQuoteProps {
  quote: string
  segment: number
  title: string | null
}

/**
 * The question. Options lock the moment the learner locks their answer in, and
 * locking in is a separate button because owning the guess is what makes the
 * correction land.
 *
 * `onContinue` is optional: when the result is shown on the same screen there is
 * nothing to continue to, and the panel ends at the locked options.
 */
export function PredictionStage({
  scene,
  outcome,
  selectedId,
  committing,
  onSelect,
  onCommit,
  onContinue,
}: {
  scene: PredictionScene
  outcome: SceneOutcome | null
  selectedId: string | null
  committing: boolean
  onSelect: (optionId: string) => void
  onCommit: (scene: PredictionScene, option: Option) => void
  onContinue?: () => void
}) {
  const committed = outcome !== null
  const chosenId = outcome?.optionId ?? selectedId

  return (
    <div>
      <h3 className="text-xl font-black leading-tight text-ink sm:text-2xl">{scene.prompt}</h3>
      {!committed && (
        <p className="mt-3 text-sm leading-6 text-ink-muted">
          Answer first, then see the explanation. Pick the one you think is right — getting it wrong is useful too.
        </p>
      )}
      <ul className="mt-5 space-y-3" aria-busy={committing}>
        {scene.options.map((option, index) => (
          <li key={option.id}>
            <OptionButton
              option={option}
              index={index}
              chosen={chosenId === option.id}
              locked={committed}
              correct={outcome ? outcome.diagnosis.correct : null}
              onSelect={() => onSelect(option.id)}
            />
          </li>
        ))}
      </ul>
      {!committed ? (
        <div className="mt-7 flex flex-wrap items-center gap-4" aria-live="polite">
          <button
            className="button-primary"
            disabled={!selectedId || committing}
            onClick={() => {
              const option = scene.options.find((candidate) => candidate.id === selectedId)
              if (option) onCommit(scene, option)
            }}
          >
            {committing ? 'Locking in…' : 'Lock in answer'}
          </button>
        </div>
      ) : (
        // Collapses to nothing when there is no reward line and no next step,
        // so the merged result screen does not open with a band of dead space.
        <div className="mt-6 flex flex-wrap items-center gap-4 empty:mt-0" aria-live="polite">
          <RewardNote outcome={outcome} />
          {onContinue && (
            <button className="button-primary" onClick={onContinue}>
              See how you did
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * The correction: what the learner thought, why it was tempting, what is
 * actually true — and, when the caller passes one, the quote from the learner's
 * own material underneath it.
 *
 * Anything missing from the data is omitted rather than filled with
 * plausible-sounding text of our own. That includes the quote: `evidence` is
 * rendered only when the caller hands one over, so a panel that shows the quote
 * on its own screen does not print it twice.
 *
 * `children` is the caller's own postscript — the quiz puts the rest of the
 * class there. It lands after the correction and the quote and before the way
 * forward, because the button has to stay the last thing on the screen.
 */
export function DiagnosisStage({
  diagnosis,
  evidence = null,
  onContinue,
  continueLabel,
  children,
}: {
  diagnosis: Diagnosis
  evidence?: SourceQuoteProps | null
  onContinue: () => void
  continueLabel: string
  children?: ReactNode
}) {
  const misconception = diagnosis.misconception
  const showPanels =
    !diagnosis.correct &&
    misconception !== null &&
    (filled(misconception.statement) || filled(misconception.why_plausible) || filled(misconception.correction))
  // "There is a quote somewhere" and "render the quote here" are different
  // questions: the first is about the data, the second is the caller's layout.
  const hasSource = diagnosis.evidence !== null && filled(diagnosis.evidence.quote)
  const showSource = evidence !== null && filled(evidence.quote)

  return (
    <div>
      <h3 className="text-2xl font-black text-ink sm:text-3xl">
        {diagnosis.correct ? "That's right." : 'Not quite.'}
      </h3>
      {diagnosis.concept && (
        <p className="mt-2 text-sm font-semibold text-ink-muted">Concept · {diagnosis.concept.label}</p>
      )}

      {showPanels ? (
        <div className="mt-6 space-y-4" aria-live="polite">
          {filled(misconception.statement) && (
            <Insight label="You thought" text={misconception.statement} tone="amber" />
          )}
          {filled(misconception.why_plausible) && (
            <Insight label="Why that's tempting" text={misconception.why_plausible} />
          )}
          {filled(misconception.correction) && (
            <Insight label="What's actually true" text={misconception.correction} tone="teal" />
          )}
        </div>
      ) : filled(diagnosis.reveal) ? (
        <div
          className={`mt-6 rounded-xl border p-5 ${
            diagnosis.correct ? 'border-secondary/25 bg-secondary/5' : 'border-primary/25 bg-primary/5'
          }`}
          aria-live="polite"
        >
          <p
            className={`text-xs font-extrabold uppercase tracking-[0.17em] ${
              diagnosis.correct ? 'text-secondary' : 'text-primary-soft'
            }`}
          >
            {diagnosis.correct ? "Why that's right" : "What's actually true"}
          </p>
          <p className="mt-2 leading-7 text-ink">{diagnosis.reveal}</p>
        </div>
      ) : hasSource ? (
        <p className="mt-6 leading-7 text-ink-muted">
          No explanation was written for this question. Here is what your own notes say.
        </p>
      ) : (
        // Promising a source here when none was extracted is the one lie this
        // screen must never tell: the whole point of the quote is that the
        // learner can check the claim against their own material.
        <p className="mt-6 leading-7 text-ink-muted">
          No explanation was written for this question, and nothing from your notes was matched to it.
        </p>
      )}

      {showPanels && filled(diagnosis.reveal) && (
        <p className="mt-5 border-l-2 border-white/15 pl-4 leading-7 text-ink-muted">{diagnosis.reveal}</p>
      )}

      {showSource && (
        <div className="mt-6">
          <SourceQuote quote={evidence.quote} segment={evidence.segment} title={evidence.title} />
        </div>
      )}

      {/* `empty:mt-0` because the quiz's postscript renders nothing on thin
          data, and a margin under an empty div is a band of dead space. */}
      {children && <div className="mt-6 empty:mt-0">{children}</div>}

      <button className="button-primary mt-7" onClick={onContinue}>
        {continueLabel}
      </button>
    </div>
  )
}

export function Insight({ label, text, tone = 'neutral' }: { label: string; text: string; tone?: 'neutral' | 'amber' | 'teal' }) {
  const color = tone === 'amber' ? 'text-primary-soft' : tone === 'teal' ? 'text-secondary' : 'text-ink-muted'
  return (
    <div className="rounded-xl border border-white/10 bg-surface-high/65 p-5">
      <p className={`text-xs font-extrabold uppercase tracking-[0.17em] ${color}`}>{label}</p>
      <p className="mt-2 leading-7 text-ink">{text}</p>
    </div>
  )
}

/**
 * The exact sentence from the learner's own upload that settles it.
 *
 * Quiet on purpose: it sits under the correction rather than competing with it.
 * Nothing here is written by us — the quote is verbatim and the caption only
 * says where it came from.
 */
export function SourceQuote({ quote, segment, title }: SourceQuoteProps) {
  return (
    <figure className="rounded-xl border border-secondary/25 bg-background/45 p-5">
      <figcaption className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-[0.17em] text-secondary">
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <path d="M5 4h10a4 4 0 0 1 4 4v12H9a4 4 0 0 1-4-4V4Z" />
          <path d="M9 20a4 4 0 0 1 4-4h6M9 8h6M9 12h7" />
        </svg>
        From your notes
      </figcaption>
      <blockquote className="mt-3 leading-7 text-ink">“{quote}”</blockquote>
      <p className="mt-3 text-xs font-semibold text-ink-muted">
        {title ? `${title} · ` : ''}Section {segment}
      </p>
    </figure>
  )
}

/** The quote on a screen of its own, for the panels that still step through it. */
export function EvidenceStage({
  quote,
  segment,
  title,
  onContinue,
}: SourceQuoteProps & { onContinue: () => void }) {
  return (
    <div>
      <h3 className="text-2xl font-black text-ink sm:text-3xl">Straight from your own material.</h3>
      <div className="mt-6">
        <SourceQuote quote={quote} segment={segment} title={title} />
      </div>
      <button className="button-primary mt-7" onClick={onContinue}>
        Back to the world
      </button>
    </div>
  )
}

/** XP is only ever claimed when the server actually recorded the attempt. */
export function RewardNote({ outcome }: { outcome: SceneOutcome }) {
  if (outcome.persistence === 'failed') {
    return (
      <span className="text-xs font-bold text-error">
        Not recorded — the connection dropped, so no XP was awarded.
      </span>
    )
  }
  if (outcome.persistence === 'offline') {
    return <span className="text-xs font-semibold text-ink-muted">Demo world · nothing is saved</span>
  }
  if (outcome.xpAwarded === null) return null
  return (
    <span className="text-xs font-bold text-secondary">
      {outcome.xpAwarded > 0 ? `+${outcome.xpAwarded} XP` : 'Already answered · no new XP'}
    </span>
  )
}

export function OptionButton({
  option,
  index,
  chosen,
  locked,
  correct,
  onSelect,
}: {
  option: Option
  index: number
  chosen: boolean
  locked: boolean
  /** Whether the chosen option was right. Null before the answer is locked in. */
  correct: boolean | null
  onSelect: () => void
}) {
  // Before the answer is locked in the only signal is selection; after it, the
  // chosen option is marked by the server's grade and the right answer is shown.
  const chosenRight = chosen && correct === true
  const tone = !locked
    ? chosen
      ? 'border-secondary bg-secondary/10'
      : 'border-white/12 bg-surface-high hover:border-secondary/50 hover:bg-surface-highest'
    : chosenRight || (option.correct && !chosen)
      ? 'border-secondary/50 bg-secondary/10'
      : chosen
        ? 'border-primary/50 bg-primary/10'
        : 'border-white/10 bg-surface-high/50 opacity-60'

  return (
    <button
      type="button"
      className={`answer-choice flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition ${tone}`}
      onClick={onSelect}
      disabled={locked}
      aria-pressed={chosen}
    >
      <span
        aria-hidden="true"
        className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg border font-mono text-sm font-bold ${
          chosen ? 'border-secondary bg-secondary text-background' : 'border-white/15 bg-background/40 text-ink-muted'
        }`}
      >
        {String.fromCharCode(65 + index)}
      </span>
      <span className="text-base font-semibold leading-6 text-ink">{option.text}</span>
      {locked && chosen && (
        <span className={`ml-auto font-black ${chosenRight ? 'text-secondary' : 'text-primary-soft'}`}>
          {chosenRight ? '✓' : '✕'}
        </span>
      )}
      {locked && !chosen && option.correct && <span className="ml-auto font-black text-secondary">✓</span>}
    </button>
  )
}

export function Notice({
  tone,
  eyebrow,
  title,
  children,
}: {
  tone: 'error' | 'quiet'
  eyebrow: string
  title: string
  children: ReactNode
}) {
  return (
    <main className="grid min-h-screen place-items-center bg-app-grid p-6">
      <section
        className={`w-full max-w-lg rounded-2xl border bg-surface p-7 shadow-2xl ${
          tone === 'error' ? 'border-error/30' : 'border-white/10'
        }`}
        role={tone === 'error' ? 'alert' : undefined}
      >
        <p className={`eyebrow ${tone === 'error' ? 'text-error' : 'text-secondary'}`}>{eyebrow}</p>
        <h1 className="mt-2 text-2xl font-black">{title}</h1>
        {children}
      </section>
    </main>
  )
}
