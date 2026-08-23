/**
 * Explain to Win: the learner teaches an idea to a student who keeps asking why.
 *
 * Every decision lives in `explainChat.ts` — what the student opens with, what
 * may be sent, what a reply means — so this file only renders and talks to the
 * one endpoint. That is what keeps it short enough to read in a hurry.
 *
 * ## Why it is a visual novel and not a chat box
 *
 * As a bare transcript this mode read as strange, and the reason was framing:
 * a chat window tells you nothing about what is being asked of you, how far in
 * you are, or what would count as finishing. The shell answers all three without
 * a word of invented copy — the student has a face and a name tag, their latest
 * question is the line on screen, `turns_remaining` is the row of pips in the
 * top bar, and the comprehension meter sits directly above the box you type in.
 * The backlog is one click away rather than in the way.
 *
 * Three behaviours are deliberate:
 *
 * - **The first message costs nothing.** The student's opening line is written
 *   on the client and carried into the first request, so the panel has a face
 *   and a voice the instant it opens.
 * - **A failure never clears the conversation.** The endpoint keeps no state:
 *   the request body is the whole conversation, so retrying re-posts the
 *   identical body. A hiccup costs one button press, never the transcript.
 * - **The 20-character floor is enforced here.** Sending too little would come
 *   back as a validation error the learner cannot act on, so the box shows how
 *   far off it is instead.
 *
 * The model is live in production and a turn takes a few seconds, so the waiting
 * state is a first-class view rather than a greyed-out button: the student is
 * visibly thinking, and the line that says so grows more honest the longer it
 * runs.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { api, ApiError } from '../api/client'
import type { Concept, CourseGraph, ExplainOut, ExplainTurn, FixtureBundleName } from '../api/types'
import type { ChatState } from './explainChat'
import {
  appendLearner,
  applyReply,
  canSend,
  chatBody,
  firstUnexplained,
  meterLabel,
  questionsLabel,
  startChat,
  stuckLabel,
} from './explainChat'
import { useCoarsePointer } from './useCoarsePointer'
import { VisualNovelShell } from './vn'
import type { VnProgress } from './vn'

/** The live grader can take a while; the server gives up at 55 seconds. */
const PATIENCE_MS = 5000

/**
 * What the name tag reads.
 *
 * The sprite is the mascot owl, but the character it is playing here is the one
 * the whole mode is named after: a student who does not get it yet. Naming them
 * anything else makes the mascot the teacher, which is backwards.
 */
const STUDENT_NAME = 'The Student'

/**
 * Where a turn is graded.
 *
 * This used to be `worldId: string | null`, and the null branch was a dead end
 * that told the learner the demo could not answer. It is a union now because
 * the two cases are two endpoints, not one endpoint and an absence: a real
 * world grades against its own row, the bundled world grades against
 * `/demo/explain/turn`, and the only thing that differs downstream is that the
 * demo awards nothing. Anything that reads `kind` has to handle both, which is
 * the point — a third dead end cannot be added by accident.
 */
export type ExplainTarget =
  | { kind: 'world'; worldId: string }
  | { kind: 'demo'; bundle: FixtureBundleName }

export interface ExplainPanelProps {
  /** Which endpoint grades a turn. See `ExplainTarget`. */
  target: ExplainTarget
  graph: CourseGraph
  /** Concepts already explained, so the panel opens on a fresh one. */
  explained: ReadonlySet<string>
  /** World XP as the server knows it. Null shows nothing rather than a zero. */
  xp?: number | null
  /** Fired once, with the graded result, when the student finally gets it. */
  onCleared: (result: ExplainOut) => void
  onClose: () => void
}

export function ExplainPanel({ target, graph, explained, xp = null, onCleared, onClose }: ExplainPanelProps) {
  const [pickedId, setPickedId] = useState<string | null>(null)
  const opening = firstUnexplained(graph.concepts, explained)
  const concept = graph.concepts.find((candidate) => candidate.id === pickedId) ?? opening

  if (!concept) {
    return (
      <VisualNovelShell
        kind="explain"
        title="Nothing to explain yet"
        xp={xp}
        speaker={{ actor: 'mentor_owl', name: STUDENT_NAME }}
        onClose={onClose}
      >
        <p className="text-sm leading-6 text-ink-muted">
          There is nothing to explain yet — this world has no ideas in it.
        </p>
        <button className="button-primary mt-6" onClick={onClose}>
          Back to the hub
        </button>
      </VisualNovelShell>
    )
  }

  // Keyed by the concept: picking another one starts a clean conversation
  // rather than leaving half of the last one on screen.
  return (
    <Conversation
      key={concept.id}
      concept={concept}
      concepts={graph.concepts}
      explained={explained}
      target={target}
      xp={xp}
      onPick={setPickedId}
      onCleared={onCleared}
      onClose={onClose}
    />
  )
}

function Conversation({
  concept,
  concepts,
  explained,
  target,
  xp,
  onPick,
  onCleared,
  onClose,
}: {
  concept: Concept
  concepts: Concept[]
  explained: ReadonlySet<string>
  target: ExplainTarget
  xp: number | null
  onPick: (id: string) => void
  onCleared: (result: ExplainOut) => void
  onClose: () => void
}) {
  const coarse = useCoarsePointer()
  const [chat, setChat] = useState<ChatState>(() => startChat(concept))
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [slow, setSlow] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const rewarded = useRef(false)

  const check = canSend(chat, draft)
  const started = chat.turns.length > 1

  /**
   * Post a conversation exactly as it stands. Retrying passes the same value.
   *
   * Both endpoints take the same body and return the same shape, so the target
   * only decides which one is called: everything below this line is identical
   * whether or not there is a server behind the world.
   */
  const post = useCallback(
    (state: ChatState) => {
      const body = chatBody(state)
      setSending(true)
      setSlow(false)
      setFailure(null)
      const reply =
        target.kind === 'world'
          ? api.explainTurn(target.worldId, body)
          : api.demoExplainTurn({ ...body, bundle: target.bundle })
      reply
        .then((answer) => setChat(applyReply(state, answer)))
        .catch((error: unknown) => setFailure(describeFailure(error)))
        .then(() => setSending(false))
    },
    [target],
  )

  const send = useCallback(() => {
    if (!check.ok || sending) return
    const next = appendLearner(chat, draft)
    setChat(next)
    setDraft('')
    post(next)
  }, [check.ok, sending, chat, draft, post])

  // "Up to a minute" is only honest to say once the wait is real. Cleared where
  // the request starts, so nothing is set synchronously from an effect.
  useEffect(() => {
    if (!sending) return
    const timer = setTimeout(() => setSlow(true), PATIENCE_MS)
    return () => clearTimeout(timer)
  }, [sending])

  // Once, whatever re-renders happen afterwards: the reward is the server's and
  // it was already written down.
  useEffect(() => {
    if (chat.done && chat.result && !rewarded.current) {
      rewarded.current = true
      onCleared(chat.result)
    }
  }, [chat.done, chat.result, onCleared])

  const done = chat.done && chat.result !== null
  const lastStudentIdx = lastIndexOf(chat.turns, 'student')
  const lastLearnerIdx = lastIndexOf(chat.turns, 'learner')
  const lastStudent = lastStudentIdx === -1 ? null : chat.turns[lastStudentIdx].text
  const lastLearner = lastLearnerIdx === -1 ? null : chat.turns[lastLearnerIdx].text
  // Everything except the exchange that is already on screen. Computed by index
  // rather than by slicing the tail, so nothing is printed twice and nothing is
  // dropped when the last turn is the learner's.
  const earlier = chat.turns.filter((_, i) => i !== lastStudentIdx && i !== lastLearnerIdx)

  /**
   * The line on screen: what the student just said, or their closing words once
   * it is over. While a reply is in flight the student is thinking rather than
   * speaking, and saying so *as the line* is what makes the three-second wait
   * part of the scene instead of a hang.
   */
  const line: string | undefined = sending
    ? slow
      ? 'Hold on — I am still thinking about that. This can take up to a minute.'
      : 'Hmm. Let me think about that…'
    : done && chat.result
      ? chat.result.feedback
      : (lastStudent ?? undefined)

  return (
    <VisualNovelShell
      kind="explain"
      title={concept.label}
      // What is being asked, in one line. It describes the mechanic, which is
      // ours to describe; it says nothing about the content, which is not.
      subtitle={done ? 'They have heard enough.' : 'Keep answering until they say they have got it.'}
      progress={turnProgress(chat)}
      xp={xp}
      speaker={{ actor: 'mentor_owl', name: STUDENT_NAME }}
      dialogue={line}
      // A retyped line every time the meter moves is a distraction; the student
      // types while they are actually saying something new.
      typeDialogue={!sending}
      footerHint={done ? undefined : coarse ? 'Tap Send when you are done' : 'Enter sends · Shift+Enter starts a new line'}
      onClose={onClose}
      closeLabel="Back to the hub"
    >
      {/* The spoken line lives in the shell, which is not a live region — it is
          normally read on entry. Here it arrives from the network while focus is
          in the box, so it is announced from here instead. */}
      <p className="sr-only" role="status" aria-live="polite">
        {line ?? ''}
      </p>

      {/* How much of it has landed, right above the box that moves it. */}
      <Meter chat={chat} />

      {/* The exchange the learner is answering. While the reply is in flight the
          line above is the student thinking, so their question moves down here
          rather than leaving the screen. */}
      {(sending || done) && lastStudent && (
        <div className="mt-5">
          <p className="eyebrow text-ink-muted">They asked</p>
          <p className="mt-2 rounded-xl rounded-bl-sm border-l-2 border-secondary/50 bg-surface-high px-4 py-3 text-sm leading-6 text-ink">
            {lastStudent}
          </p>
        </div>
      )}

      {lastLearner && (
        <div className="mt-5">
          <p className="eyebrow text-ink-muted">You said</p>
          <p className="mt-2 rounded-xl rounded-br-sm border-r-2 border-primary/50 bg-primary/10 px-4 py-3 text-sm leading-6 text-ink">
            {lastLearner}
          </p>
        </div>
      )}

      {/* Everything before that, out of the way but never lost. */}
      <Backlog turns={earlier} conceptLabel={concept.label} />

      {/* Under the conversation, never over it: the words the learner wrote stay
          on screen while they decide what to do about the failure. */}
      {failure && (
        <div className="mt-5 flex flex-wrap items-center gap-3 rounded-xl border border-error/40 bg-error/10 px-4 py-3">
          <p className="flex-1 text-sm font-semibold leading-6 text-error">{failure}</p>
          <button type="button" className="button-secondary" onClick={() => post(chat)} disabled={sending}>
            Try again
          </button>
        </div>
      )}

      {done && chat.result ? (
        <div className="mt-6 flex flex-wrap items-center gap-4">
          {/* Only ever the server's own number. */}
          {chat.result.xp_awarded > 0 && (
            <span className="rounded-full border border-primary/35 bg-primary/10 px-4 py-2 text-sm font-black text-primary-soft">
              +{chat.result.xp_awarded} XP
            </span>
          )}
          <button className="button-primary" onClick={onClose}>
            Back to the hub
          </button>
        </div>
      ) : (
        <div className="mt-6">
          <label className="field-label" htmlFor="explain-draft">
            Your answer
          </label>
          <textarea
            id="explain-draft"
            className="field min-h-28 resize-y"
            placeholder={`Explain ${concept.label.toLowerCase()} in your own words…`}
            value={draft}
            disabled={sending}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              // A phone keyboard has no Shift+Enter, so on touch this shortcut
              // meant the learner could never write a second paragraph and
              // every Return posted a half-finished answer.
              if (coarse) return
              // IME composition commits with Enter; sending there would post
              // mid-word for anyone typing Japanese, Chinese or Korean.
              if (event.nativeEvent.isComposing) return
              if (event.key !== 'Enter' || event.shiftKey) return
              event.preventDefault()
              send()
            }}
          />
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs font-semibold text-ink-muted" aria-live="polite">
              {check.reason ??
                (check.charsNeeded > 0
                  ? `Say at least ${check.charsNeeded} characters so the student has something to work with.`
                  : sending
                    ? 'Waiting on the student…'
                    : coarse
                      ? 'Tap Send when you are done.'
                      : 'Enter to send · Shift+Enter for a new line')}
            </p>
            <button type="button" className="button-primary" onClick={send} disabled={!check.ok || sending}>
              {sending ? 'Sending…' : 'Send'}
            </button>
          </div>
        </div>
      )}

      {/* Switching ideas is offered where it cannot cost anything: before the
          first answer, and once this one is finished. */}
      {concepts.length > 1 && (!started || done) && (
        <fieldset className="mt-7 border-t border-white/10 pt-6">
          <legend className="field-label">What do you want to explain?</legend>
          <div className="flex flex-wrap gap-2">
            {concepts.map((candidate) => (
              <button
                key={candidate.id}
                type="button"
                onClick={() => onPick(candidate.id)}
                aria-pressed={candidate.id === concept.id}
                className={`rounded-xl border px-3 py-2 text-sm font-bold transition ${
                  candidate.id === concept.id
                    ? 'border-secondary/60 bg-secondary/15 text-ink'
                    : 'border-white/10 bg-surface-high text-ink-muted hover:border-white/25 hover:text-ink'
                }`}
              >
                {candidate.label}
                {/* The space is not decoration: without it the button reads as
                    one run-together word to a screen reader. */}
                {explained.has(candidate.id) && <span className="ml-2 text-xs text-secondary"> done</span>}
              </button>
            ))}
          </div>
        </fieldset>
      )}
    </VisualNovelShell>
  )
}

/** Where one side of the conversation last spoke, or -1. */
function lastIndexOf(turns: readonly ExplainTurn[], role: ExplainTurn['role']): number {
  for (let i = turns.length - 1; i >= 0; i -= 1) {
    if (turns[i].role === role) return i
  }
  return -1
}

/**
 * How far through the conversation the learner is, as pips.
 *
 * Both numbers are the server's: `turns_remaining` is what it says is left, and
 * the answers already given are on the wire in front of it. Before the first
 * reply lands there is no honest total to draw, so there are no pips — the shell
 * omits the block rather than inventing a length for the run.
 */
function turnProgress(chat: ChatState): VnProgress | null {
  const given = chat.turns.filter((turn) => turn.role === 'learner').length
  if (chat.done) return given > 0 ? { done: given, total: given, label: 'answers given' } : null
  if (chat.questionsLeft === null) return null
  return { done: given, total: given + chat.questionsLeft, label: 'answers given' }
}

/**
 * The conversation so far, folded away.
 *
 * A visual novel shows one line at a time and keeps a backlog; this is the
 * backlog. Closed by default because the current exchange is what the learner is
 * answering, and open in one click because nothing they wrote may become
 * unreachable.
 */
function Backlog({ turns, conceptLabel }: { turns: readonly ExplainTurn[]; conceptLabel: string }) {
  if (turns.length === 0) return null

  return (
    <details className="mt-5 rounded-xl border border-white/10 bg-background/40">
      <summary className="cursor-pointer px-4 py-3 text-xs font-extrabold uppercase tracking-[0.14em] text-ink-muted">
        The conversation so far · {turns.length}
      </summary>
      <div className="space-y-3 px-4 pb-4" aria-label={`Your conversation about ${conceptLabel}`}>
        {turns.map((turn, index) => (
          <div key={index} className={turn.role === 'learner' ? 'flex justify-end' : ''}>
            <p
              className={`max-w-[85%] rounded-xl px-4 py-3 text-sm leading-6 ${
                turn.role === 'learner'
                  ? 'rounded-br-sm bg-primary/15 text-ink'
                  : 'rounded-bl-sm bg-surface-high text-ink-muted'
              }`}
            >
              {turn.text}
            </p>
          </div>
        ))}
      </div>
    </details>
  )
}

/**
 * How much the student has got, in plain words.
 *
 * The number is the server's — it is the same one the XP was paid against —
 * and it stops moving once the conversation is over.
 */
function Meter({ chat }: { chat: ChatState }) {
  const left = questionsLabel(chat)
  const stuck = stuckLabel(chat)
  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <p className="text-sm font-bold text-ink" aria-live="polite">
          {meterLabel(chat)}
        </p>
        {left && <p className="text-xs font-bold text-secondary">{left}</p>}
      </div>
      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-white/10">
        <div
          className={`h-full rounded-full transition-[width] duration-500 ${
            chat.done ? 'bg-primary' : 'bg-secondary'
          }`}
          style={{ width: `${chat.understanding}%` }}
        />
      </div>
      {stuck && <p className="mt-2 text-xs leading-5 text-ink-muted">{stuck}</p>}
    </div>
  )
}

/**
 * Why the student went quiet, in words the learner can act on.
 *
 * A 503 is the grader being down on the live path — the one failure that is
 * genuinely worth pressing a button about, because nothing was written and the
 * retry sends the same conversation back.
 */
function describeFailure(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 503) {
      return 'The student could not answer just now. Nothing you wrote was lost — try again.'
    }
    if (error.status === 401) return 'You are signed out, so this could not be saved. Sign in and try again.'
    // Reachable since the public link went out: every grading endpoint is rate
    // limited. Nothing was lost, so the wording is a wait, not a failure.
    if (error.status === 429) {
      return 'That was a lot of messages at once. Give it a few seconds, then send it again.'
    }
    if (error.status === 409) return 'This world is not ready yet.'
    return error.message
  }
  return 'The server could not be reached. Check your connection and try again.'
}
