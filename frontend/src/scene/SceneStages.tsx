/**
 * The panels that render one scene's content.
 *
 * They are deliberately independent of how the player reached that scene: they
 * take a scene, what was committed on it, and callbacks, and nothing else. No
 * canvas, no player, no load machine, no session. That is what lets a portal
 * panel and the map overlay show the same scene without either one
 * reimplementing the teaching loop.
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

/**
 * The gate. Options lock the moment the learner commits, and committing is a
 * separate button because owning the guess is what makes the correction land.
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
  onContinue: () => void
}) {
  const committed = outcome !== null
  const chosenId = outcome?.optionId ?? selectedId

  return (
    <div>
      <p className="eyebrow">Prediction gate</p>
      <h3 className="mt-3 text-xl font-black leading-tight text-ink sm:text-2xl">{scene.prompt}</h3>
      <p className="mt-3 text-sm leading-6 text-ink-muted">
        Answer before you are taught. Commit to the one that feels most defensible — a wrong turn is the useful part.
      </p>
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
      <div className="mt-7 flex flex-wrap items-center gap-4" aria-live="polite">
        {!committed ? (
          <button
            className="button-primary"
            disabled={!selectedId || committing}
            onClick={() => {
              const option = scene.options.find((candidate) => candidate.id === selectedId)
              if (option) onCommit(scene, option)
            }}
          >
            {committing ? 'Committing…' : 'Commit answer'}
          </button>
        ) : (
          <>
            <span
              className={`rounded-full px-3 py-1.5 text-sm font-bold ${
                outcome.diagnosis.correct ? 'bg-secondary/10 text-secondary' : 'bg-primary/10 text-primary-soft'
              }`}
            >
              {outcome.diagnosis.correct ? 'Prediction logged' : 'Wrong turn captured'}
            </span>
            <RewardNote outcome={outcome} />
            <button className="button-primary" onClick={onContinue}>
              Inspect the result
            </button>
          </>
        )}
      </div>
    </div>
  )
}

/**
 * The three-part correction: the belief the learner just showed, why it was
 * tempting, and what is true instead. Panels missing from the data are omitted
 * rather than filled with plausible-sounding text of our own.
 */
export function DiagnosisStage({
  diagnosis,
  onContinue,
  continueLabel,
}: {
  diagnosis: Diagnosis
  onContinue: () => void
  continueLabel: string
}) {
  const misconception = diagnosis.misconception
  const showPanels =
    !diagnosis.correct &&
    misconception !== null &&
    (filled(misconception.statement) || filled(misconception.why_plausible) || filled(misconception.correction))

  return (
    <div>
      <p className="eyebrow">Misconception diagnosis</p>
      <h3 className="mt-3 text-2xl font-black text-ink sm:text-3xl">
        {diagnosis.correct ? 'Signal recognised.' : 'Wrong turn detected.'}
      </h3>
      {diagnosis.concept && (
        <p className="mt-2 text-sm font-semibold text-ink-muted">Concept · {diagnosis.concept.label}</p>
      )}

      {showPanels ? (
        <div className="mt-6 space-y-4" aria-live="polite">
          {filled(misconception.statement) && (
            <Insight label="The belief you committed to" text={misconception.statement} tone="amber" />
          )}
          {filled(misconception.why_plausible) && (
            <Insight label="Why it felt plausible" text={misconception.why_plausible} />
          )}
          {filled(misconception.correction) && (
            <Insight label="What is true instead" text={misconception.correction} tone="teal" />
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
            {diagnosis.correct ? 'Reasoning confirmed' : 'What is true instead'}
          </p>
          <p className="mt-2 leading-7 text-ink">{diagnosis.reveal}</p>
        </div>
      ) : diagnosis.evidence && filled(diagnosis.evidence.quote) ? (
        <p className="mt-6 leading-7 text-ink-muted">
          This scene has no written explanation attached. What the course itself says is quoted next.
        </p>
      ) : (
        // Promising a source here when none was extracted is the one lie this
        // screen must never tell: the whole point of the evidence step is that
        // the learner can check the claim against their own material.
        <p className="mt-6 leading-7 text-ink-muted">
          This scene has no written explanation attached, and no source quote was extracted for this concept.
        </p>
      )}

      {showPanels && filled(diagnosis.reveal) && (
        <p className="mt-5 border-l-2 border-white/15 pl-4 leading-7 text-ink-muted">{diagnosis.reveal}</p>
      )}

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

/** The receipt: the exact sentence from the learner's own upload that settles it. */
export function EvidenceStage({
  quote,
  segment,
  title,
  onContinue,
}: {
  quote: string
  segment: number
  title: string | null
  onContinue: () => void
}) {
  return (
    <div>
      <p className="eyebrow">Verified source receipt</p>
      <h3 className="mt-3 text-2xl font-black text-ink sm:text-3xl">Straight from your own material.</h3>
      <figure className="relative mt-6 overflow-hidden rounded-2xl border border-secondary/30 bg-background/45 p-6 sm:p-7">
        <div
          className="absolute right-0 top-0 h-28 w-28 -translate-y-8 translate-x-8 rounded-full bg-secondary/10 blur-2xl"
          aria-hidden="true"
        />
        <div className="flex items-center gap-3 text-secondary">
          <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <path d="M5 4h10a4 4 0 0 1 4 4v12H9a4 4 0 0 1-4-4V4Z" />
            <path d="M9 20a4 4 0 0 1 4-4h6M9 8h6M9 12h7" />
          </svg>
          <span className="text-xs font-extrabold uppercase tracking-[0.18em]">Exact course excerpt</span>
        </div>
        <blockquote className="mt-5 text-lg font-semibold leading-8 text-ink sm:text-xl">“{quote}”</blockquote>
        <figcaption className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-white/10 pt-4 text-sm">
          {title && <span className="font-bold text-ink">{title}</span>}
          <span className="font-mono text-secondary">Segment {segment}</span>
          <span className="ml-auto rounded-full border border-secondary/25 bg-secondary/10 px-3 py-1 text-xs font-bold text-secondary">
            Source matched
          </span>
        </figcaption>
      </figure>
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
  /** The graded verdict for the chosen option. Null before the commit. */
  correct: boolean | null
  onSelect: () => void
}) {
  // Before the commit the only signal is selection; after it, the chosen option
  // is marked by the server's verdict and the right answer is revealed.
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
