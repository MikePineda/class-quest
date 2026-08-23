import { useReducer } from 'react'
import type { Misconception, Option } from '../api/types'
import { fixtureGraph, fixtureQuest } from '../fixtures'
import { AnswerChoices } from './AnswerChoices'
import { ConceptTrail } from './ConceptTrail'
import { findMisconception, resolveDemoEncounter } from './demoData'
import { Brand } from '../foundation/Brand'
import { BackLink } from '../nav/BackLink'

type DemoPhase = 'intro' | 'prediction' | 'diagnosis' | 'source' | 'transfer' | 'result'

interface DemoState {
  phase: DemoPhase
  predictionId: string | null
  predictionCommitted: boolean
  transferId: string | null
  transferCommitted: boolean
  transferAttempts: number
}

type DemoAction =
  | { type: 'START' }
  | { type: 'SELECT_PREDICTION'; optionId: string }
  | { type: 'COMMIT_PREDICTION' }
  | { type: 'SHOW_DIAGNOSIS' }
  | { type: 'SHOW_SOURCE' }
  | { type: 'BEGIN_TRANSFER' }
  | { type: 'SELECT_TRANSFER'; optionId: string }
  | { type: 'COMMIT_TRANSFER' }
  | { type: 'RETRY_TRANSFER' }
  | { type: 'SHOW_RESULT' }
  | { type: 'RESTART' }

const initialState: DemoState = {
  phase: 'intro',
  predictionId: null,
  predictionCommitted: false,
  transferId: null,
  transferCommitted: false,
  transferAttempts: 0,
}

function reducer(state: DemoState, action: DemoAction): DemoState {
  switch (action.type) {
    case 'START':
      return state.phase === 'intro' ? { ...state, phase: 'prediction' } : state
    case 'SELECT_PREDICTION':
      return state.phase === 'prediction' && !state.predictionCommitted
        ? { ...state, predictionId: action.optionId }
        : state
    case 'COMMIT_PREDICTION':
      return state.phase === 'prediction' && state.predictionId ? { ...state, predictionCommitted: true } : state
    case 'SHOW_DIAGNOSIS':
      return state.phase === 'prediction' && state.predictionCommitted ? { ...state, phase: 'diagnosis' } : state
    case 'SHOW_SOURCE':
      return state.phase === 'diagnosis' ? { ...state, phase: 'source' } : state
    case 'BEGIN_TRANSFER':
      return state.phase === 'source' ? { ...state, phase: 'transfer' } : state
    case 'SELECT_TRANSFER':
      return state.phase === 'transfer' && !state.transferCommitted
        ? { ...state, transferId: action.optionId }
        : state
    case 'COMMIT_TRANSFER':
      return state.phase === 'transfer' && state.transferId
        ? { ...state, transferCommitted: true, transferAttempts: state.transferAttempts + 1 }
        : state
    case 'RETRY_TRANSFER':
      return state.phase === 'transfer' ? { ...state, transferId: null, transferCommitted: false } : state
    case 'SHOW_RESULT':
      return state.phase === 'transfer' && state.transferCommitted ? { ...state, phase: 'result' } : state
    case 'RESTART':
      return initialState
  }
}

const phaseMeta: Record<DemoPhase, { step: string; label: string }> = {
  intro: { step: '00', label: 'Briefing' },
  prediction: { step: '01', label: 'Prediction' },
  diagnosis: { step: '02', label: 'Diagnosis' },
  source: { step: '03', label: 'Evidence' },
  transfer: { step: '04', label: 'Transfer' },
  result: { step: '05', label: 'Recovery' },
}

const primaryButton =
  'button-primary'

const secondaryButton =
  'button-secondary'

function selectedOption(options: Option[], id: string | null) {
  return options.find((option) => option.id === id)
}

export function DemoExperience() {
  const [state, dispatch] = useReducer(reducer, initialState)
  const resolution = (() => {
    try {
      return { encounter: resolveDemoEncounter(fixtureGraph, fixtureQuest), error: null }
    } catch (error) {
      return {
        encounter: null,
        error: error instanceof Error ? error.message : 'The demo encounter could not be prepared.',
      }
    }
  })()

  if (!resolution.encounter) {
    return (
      <main className="grid min-h-screen place-items-center p-6">
        <section className="w-full max-w-lg rounded-2xl border border-error/30 bg-surface p-7 shadow-2xl" role="alert">
          <p className="eyebrow text-error">Quest unavailable</p>
          <h1 className="mt-2 text-2xl font-black">The evidence trail could not be loaded.</h1>
          <p className="mt-3 text-ink-muted">{resolution.error}</p>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            {/* The fixture is compiled in, so a throw here throws again after a
                reload. Without a second option this was a genuine dead end. */}
            <button className={primaryButton} onClick={() => window.location.reload()}>
              Restart demo
            </button>
            <BackLink to="/">Leave the demo</BackLink>
          </div>
        </section>
      </main>
    )
  }

  const encounter = resolution.encounter
  const predictionChoice = selectedOption(encounter.prediction.options, state.predictionId)
  const transferChoice = selectedOption(encounter.transfer.options, state.transferId)
  const predictionMisconception = findMisconception(encounter.concept, predictionChoice)
  const transferMisconception = findMisconception(encounter.concept, transferChoice)
  const transferCorrect = Boolean(transferChoice?.correct)
  const recovered = state.phase === 'result'

  return (
    <div className="min-h-screen overflow-hidden bg-quest-grid">
      <header className="border-b border-white/10 bg-background-raised/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
          <Brand compact subtitle="Wrong-Turn Quest" />
          <div className="flex items-center gap-3">
            <span className="hidden items-center gap-2 rounded-full border border-secondary/25 bg-secondary/10 px-3 py-1.5 text-xs font-bold text-secondary sm:inline-flex">
              <span className="h-2 w-2 rounded-full bg-secondary" aria-hidden="true" /> Offline demo
            </span>
            {state.phase !== 'intro' && (
              <button type="button" className="text-sm font-semibold text-ink-muted underline-offset-4 hover:text-ink hover:underline" onClick={() => dispatch({ type: 'RESTART' })}>
                Restart
              </button>
            )}
            {/* This file used to contain no links at all, and it is the first
                thing a visitor with no account clicks. */}
            <BackLink to="/">Leave the demo</BackLink>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 lg:py-12">
        <div className="mb-7 flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-primary/30 bg-primary/10 px-3 py-1 font-hud text-[9px] tracking-[0.1em] text-primary">WRONG-TURN QUEST</span>
              <span className="font-hud text-[9px] tracking-[0.1em] text-ink-muted">{encounter.chapter.title}</span>
            </div>
            <h1 className="mt-4 text-3xl font-black tracking-tight text-ink sm:text-4xl lg:text-5xl">Misconception Detective</h1>
            <p className="mt-3 max-w-2xl text-base leading-7 text-ink-muted sm:text-lg">Make a prediction, inspect the evidence, then prove the concept transfers.</p>
          </div>
          <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-surface/70 px-4 py-3">
            <span className="font-hud text-sm text-primary">{phaseMeta[state.phase].step}</span>
            <span className="h-6 w-px bg-white/15" aria-hidden="true" />
            <span className="text-sm font-bold text-ink">{phaseMeta[state.phase].label}</span>
          </div>
        </div>

        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <section className="cq-panel quest-panel min-h-[34rem] bg-surface/90 p-5 backdrop-blur sm:p-8 lg:p-10">
            <div key={state.phase} className="stage-enter">
              {state.phase === 'intro' && (
                <IntroStage title={fixtureQuest.title} conceptLabel={encounter.concept.label} summary={encounter.concept.summary} lines={encounter.intro?.lines ?? []} onStart={() => dispatch({ type: 'START' })} />
              )}
              {state.phase === 'prediction' && (
                <PredictionStage prompt={encounter.prediction.prompt} options={encounter.prediction.options} selectedId={state.predictionId} committed={state.predictionCommitted} choiceCorrect={Boolean(predictionChoice?.correct)} onSelect={(optionId) => dispatch({ type: 'SELECT_PREDICTION', optionId })} onCommit={() => dispatch({ type: 'COMMIT_PREDICTION' })} onContinue={() => dispatch({ type: 'SHOW_DIAGNOSIS' })} />
              )}
              {state.phase === 'diagnosis' && (
                <DiagnosisStage correct={Boolean(predictionChoice?.correct)} reveal={encounter.prediction.reveal} misconception={predictionMisconception} onContinue={() => dispatch({ type: 'SHOW_SOURCE' })} />
              )}
              {state.phase === 'source' && (
                <SourceStage quote={encounter.sourceSpan.quote} title={encounter.sourceTitle} segment={encounter.sourceSpan.segment_id} onContinue={() => dispatch({ type: 'BEGIN_TRANSFER' })} />
              )}
              {state.phase === 'transfer' && (
                <TransferStage prompt={encounter.transfer.prompt} options={encounter.transfer.options} selectedId={state.transferId} committed={state.transferCommitted} correct={transferCorrect} reveal={encounter.transfer.reveal} misconception={transferMisconception} attempts={state.transferAttempts} onSelect={(optionId) => dispatch({ type: 'SELECT_TRANSFER', optionId })} onCommit={() => dispatch({ type: 'COMMIT_TRANSFER' })} onRetry={() => dispatch({ type: 'RETRY_TRANSFER' })} onContinue={() => dispatch({ type: 'SHOW_RESULT' })} />
              )}
              {state.phase === 'result' && (
                <ResultStage label={encounter.concept.label} summary={encounter.concept.summary} onRestart={() => dispatch({ type: 'RESTART' })} />
              )}
            </div>
          </section>
          <ConceptTrail graph={fixtureGraph} activeConceptId={encounter.concept.id} recovered={recovered} />
        </div>
      </main>
    </div>
  )
}

function IntroStage({ title, conceptLabel, summary, lines, onStart }: { title: string; conceptLabel: string; summary: string; lines: string[]; onStart: () => void }) {
  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_14rem] lg:items-center">
      <div>
        <p className="eyebrow">Case file / {title}</p>
        <h2 className="mt-3 text-3xl font-black tracking-tight sm:text-4xl">Recover the idea behind {conceptLabel.toLowerCase()}.</h2>
        <p className="mt-4 max-w-2xl text-lg leading-8 text-ink-muted">{summary}</p>
        {lines.length > 0 && <blockquote className="mt-7 border-l-2 border-secondary pl-5 text-base italic leading-7 text-ink">“{lines.join(' ')}”</blockquote>}
        <div className="mt-8 flex flex-wrap items-center gap-4">
          <button className={primaryButton} onClick={onStart}>Begin investigation</button>
          <span className="text-sm text-ink-muted">About 60 seconds · No login required</span>
        </div>
      </div>
      <div className="mx-auto grid h-48 w-48 place-items-center rounded-full border border-secondary/25 bg-secondary/5 shadow-[0_0_80px_rgba(67,217,196,0.12)]" aria-hidden="true">
        <img className="pixel-art h-32 w-32 object-contain" src="/brand/sprites/mentor-owl.png" alt="" />
      </div>
    </div>
  )
}

function PredictionStage({ prompt, options, selectedId, committed, choiceCorrect, onSelect, onCommit, onContinue }: { prompt: string; options: Option[]; selectedId: string | null; committed: boolean; choiceCorrect: boolean; onSelect: (optionId: string) => void; onCommit: () => void; onContinue: () => void }) {
  return (
    <div className="max-w-3xl">
      <p className="eyebrow">Prediction gate</p>
      <h2 className="mt-3 text-2xl font-black leading-tight sm:text-3xl">{prompt}</h2>
      <p className="mt-3 text-ink-muted">Commit to the answer that feels most defensible. The wrong turn is useful evidence.</p>
      <div className="mt-7"><AnswerChoices options={options} selectedId={selectedId} locked={committed} label={prompt} onSelect={onSelect} /></div>
      <div className="mt-7 flex flex-wrap items-center gap-4" aria-live="polite">
        {!committed ? <button className={primaryButton} disabled={!selectedId} onClick={onCommit}>Commit answer</button> : (
          <><span className={`rounded-full px-3 py-1.5 text-sm font-bold ${choiceCorrect ? 'bg-secondary/10 text-secondary' : 'bg-primary/10 text-primary-soft'}`}>{choiceCorrect ? 'Prediction logged' : 'Wrong turn captured'}</span><button className={primaryButton} onClick={onContinue}>Inspect the result</button></>
        )}
      </div>
    </div>
  )
}

function DiagnosisStage({ correct, reveal, misconception, onContinue }: { correct: boolean; reveal: string; misconception: Misconception | null; onContinue: () => void }) {
  return (
    <div className="max-w-3xl">
      <p className="eyebrow">Misconception diagnosis</p>
      <h2 className="mt-3 text-3xl font-black">{correct ? 'Signal recognised.' : 'Wrong turn detected.'}</h2>
      {misconception ? (
        <div className="mt-7 space-y-4" aria-live="polite">
          <Insight label="The belief" text={misconception.statement} tone="amber" />
          <Insight label="Why it felt plausible" text={misconception.why_plausible} />
          <Insight label="The correction" text={misconception.correction} tone="teal" />
        </div>
      ) : <div className="mt-7 rounded-xl border border-secondary/25 bg-secondary/8 p-5"><p className="text-sm font-bold uppercase tracking-[0.16em] text-secondary">Reasoning confirmed</p><p className="mt-3 leading-7 text-ink">{reveal}</p></div>}
      <button className={`${primaryButton} mt-7`} onClick={onContinue}>Open verified evidence</button>
    </div>
  )
}

function Insight({ label, text, tone = 'neutral' }: { label: string; text: string; tone?: 'neutral' | 'amber' | 'teal' }) {
  const color = tone === 'amber' ? 'text-primary-soft' : tone === 'teal' ? 'text-secondary' : 'text-ink-muted'
  return <div className="rounded-xl border border-white/10 bg-surface-high/65 p-5"><p className={`text-xs font-extrabold uppercase tracking-[0.17em] ${color}`}>{label}</p><p className="mt-2 leading-7 text-ink">{text}</p></div>
}

function SourceStage({ quote, title, segment, onContinue }: { quote: string; title: string; segment: number; onContinue: () => void }) {
  return (
    <div className="max-w-3xl">
      <p className="eyebrow">Verified source receipt</p>
      <h2 className="mt-3 text-3xl font-black">Check the claim against the course.</h2>
      <div className="relative mt-8 overflow-hidden rounded-2xl border border-secondary/30 bg-background/45 p-6 sm:p-8">
        <div className="absolute right-0 top-0 h-28 w-28 translate-x-8 -translate-y-8 rounded-full bg-secondary/10 blur-2xl" aria-hidden="true" />
        <div className="flex items-center gap-3 text-secondary"><svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M5 4h10a4 4 0 0 1 4 4v12H9a4 4 0 0 1-4-4V4Z" /><path d="M9 20a4 4 0 0 1 4-4h6M9 8h6M9 12h7" /></svg><span className="text-xs font-extrabold uppercase tracking-[0.18em]">Exact course excerpt</span></div>
        <blockquote className="mt-6 text-xl font-semibold leading-9 text-ink sm:text-2xl">“{quote}”</blockquote>
        <div className="mt-7 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-white/10 pt-5 text-sm"><span className="font-bold text-ink">{title}</span><span className="hidden h-4 w-px bg-white/20 sm:block" aria-hidden="true" /><span className="font-mono text-secondary">Segment {segment}</span><span className="ml-auto rounded-full border border-secondary/25 bg-secondary/10 px-3 py-1 text-xs font-bold text-secondary">Source matched</span></div>
      </div>
      <button className={`${primaryButton} mt-7`} onClick={onContinue}>Apply it to a new case</button>
    </div>
  )
}

function TransferStage({ prompt, options, selectedId, committed, correct, reveal, misconception, attempts, onSelect, onCommit, onRetry, onContinue }: { prompt: string; options: Option[]; selectedId: string | null; committed: boolean; correct: boolean; reveal: string; misconception: Misconception | null; attempts: number; onSelect: (optionId: string) => void; onCommit: () => void; onRetry: () => void; onContinue: () => void }) {
  return (
    <div className="max-w-3xl">
      <div className="flex flex-wrap items-center justify-between gap-3"><p className="eyebrow">Transfer retry</p>{attempts > 0 && <span className="text-xs font-semibold text-ink-muted">Attempts: {attempts}</span>}</div>
      <h2 className="mt-3 text-2xl font-black leading-tight sm:text-3xl">{prompt}</h2>
      <p className="mt-3 text-ink-muted">The situation changed. The underlying concept did not.</p>
      <div className="mt-7"><AnswerChoices options={options} selectedId={selectedId} locked={committed} label={prompt} onSelect={onSelect} /></div>
      <div className="mt-7" aria-live="polite">
        {!committed ? <button className={primaryButton} disabled={!selectedId} onClick={onCommit}>Check transfer</button> : correct ? (
          <div className="rounded-xl border border-secondary/30 bg-secondary/8 p-5"><p className="text-sm font-extrabold uppercase tracking-[0.16em] text-secondary">Concept transferred</p><p className="mt-2 leading-7 text-ink">{reveal}</p><button className={`${primaryButton} mt-5`} onClick={onContinue}>Restore concept</button></div>
        ) : (
          <div className="rounded-xl border border-primary/30 bg-primary/8 p-5"><p className="text-sm font-extrabold uppercase tracking-[0.16em] text-primary-soft">One clue before you retry</p><p className="mt-2 leading-7 text-ink">{misconception?.correction ?? reveal}</p><button className={`${secondaryButton} mt-5`} onClick={onRetry}>Try the transfer again</button></div>
        )}
      </div>
    </div>
  )
}

function ResultStage({ label, summary, onRestart }: { label: string; summary: string; onRestart: () => void }) {
  return (
    <div className="mx-auto max-w-2xl py-6 text-center sm:py-12">
      <div className="mx-auto grid h-24 w-24 place-items-center rounded-full border border-secondary/35 bg-secondary/10 shadow-[0_0_65px_rgba(79,219,200,0.22)]" aria-hidden="true"><svg className="h-12 w-12 text-secondary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m5 12 4 4L19 6" /></svg></div>
      <p className="eyebrow mt-7 text-secondary">Concept restored</p>
      <h2 className="mt-3 text-4xl font-black tracking-tight sm:text-5xl">{label} recovered.</h2>
      <p className="mx-auto mt-5 max-w-xl text-lg leading-8 text-ink-muted">{summary}</p>
      <div className="mx-auto mt-7 grid max-w-md grid-cols-3 divide-x divide-white/10 rounded-xl border border-white/10 bg-background/35 py-4"><ResultMetric label="Predicted" /><ResultMetric label="Verified" /><ResultMetric label="Transferred" /></div>
      <button className={`${secondaryButton} mt-8`} onClick={onRestart}>Replay the case</button>
    </div>
  )
}

function ResultMetric({ label }: { label: string }) {
  return <div className="px-2"><p className="text-xl font-black text-secondary">✓</p><p className="mt-1 text-xs font-semibold text-ink-muted">{label}</p></div>
}
