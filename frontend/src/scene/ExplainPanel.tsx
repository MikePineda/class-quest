/**
 * Explain to Win: the learner teaches an idea to a student who keeps asking why.
 *
 * Every decision lives in `explainChat.ts` — what the student opens with, what
 * may be sent, what a reply means — so this file only renders and talks to the
 * one endpoint. That is what keeps it short enough to read in a hurry.
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
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { api, ApiError } from '../api/client'
import type { Concept, CourseGraph, ExplainOut } from '../api/types'
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

const MASCOT = '/sprites/actors/mentor_owl_idle.png'
/** The live grader can take a while; the server gives up at 55 seconds. */
const PATIENCE_MS = 5000

export interface ExplainPanelProps {
  /** Null on the bundled demo world, which has no server behind it. */
  worldId: string | null
  graph: CourseGraph
  /** Concepts already explained, so the panel opens on a fresh one. */
  explained: ReadonlySet<string>
  /** Fired once, with the graded result, when the student finally gets it. */
  onCleared: (result: ExplainOut) => void
  onClose: () => void
}

export function ExplainPanel({ worldId, graph, explained, onCleared, onClose }: ExplainPanelProps) {
  const [pickedId, setPickedId] = useState<string | null>(null)
  const opening = firstUnexplained(graph.concepts, explained)
  const concept = graph.concepts.find((candidate) => candidate.id === pickedId) ?? opening

  if (!concept) {
    return (
      <div>
        <p className="text-sm leading-6 text-ink-muted">
          There is nothing to explain yet — this world has no ideas in it.
        </p>
        <button className="button-primary mt-6" onClick={onClose}>
          Back to the hub
        </button>
      </div>
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
      worldId={worldId}
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
  worldId,
  onPick,
  onCleared,
  onClose,
}: {
  concept: Concept
  concepts: Concept[]
  explained: ReadonlySet<string>
  worldId: string | null
  onPick: (id: string) => void
  onCleared: (result: ExplainOut) => void
  onClose: () => void
}) {
  const [chat, setChat] = useState<ChatState>(() => startChat(concept))
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [slow, setSlow] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const feedRef = useRef<HTMLDivElement | null>(null)
  const rewarded = useRef(false)

  const check = canSend(chat, draft)
  const started = chat.turns.length > 1

  /** Post a conversation exactly as it stands. Retrying passes the same value. */
  const post = useCallback(
    (state: ChatState) => {
      if (!worldId) {
        setFailure('The demo world has no server behind it, so the student cannot answer here.')
        return
      }
      setSending(true)
      setSlow(false)
      setFailure(null)
      api
        .explainTurn(worldId, chatBody(state))
        .then((reply) => setChat(applyReply(state, reply)))
        .catch((error: unknown) => setFailure(describeFailure(error)))
        .then(() => setSending(false))
    },
    [worldId],
  )

  const send = useCallback(() => {
    if (!check.ok || sending) return
    const next = appendLearner(chat, draft)
    setChat(next)
    setDraft('')
    post(next)
  }, [check.ok, sending, chat, draft, post])

  // Newest message in view. Runs on every reply and on the waiting row, which
  // is exactly when the feed grows.
  useEffect(() => {
    const feed = feedRef.current
    if (feed) feed.scrollTop = feed.scrollHeight
  }, [chat.turns.length, sending, chat.done])

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

  return (
    <div>
      {concepts.length > 1 && (!started || chat.done) && (
        <fieldset className="mb-5">
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

      <Meter chat={chat} />

      <div
        ref={feedRef}
        className="mt-4 max-h-[42vh] space-y-4 overflow-y-auto rounded-xl border border-white/10 bg-background/40 p-4"
        role="log"
        aria-live="polite"
        aria-label={`Your conversation about ${concept.label}`}
      >
        {chat.turns.map((turn, index) =>
          turn.role === 'student' ? (
            <Said key={index} text={turn.text} />
          ) : (
            <div key={index} className="flex justify-end">
              <p className="max-w-[85%] rounded-xl rounded-br-sm bg-primary/15 px-4 py-3 text-sm leading-6 text-ink">
                {turn.text}
              </p>
            </div>
          ),
        )}

        {sending && (
          <Said
            text={slow ? 'the student is thinking… this can take up to a minute.' : 'the student is thinking…'}
            muted
          />
        )}

        {chat.done && chat.result && <Said text={chat.result.feedback} />}
      </div>

      {/* Under the conversation, never over it: the words the learner wrote stay
          on screen while they decide what to do about the failure. */}
      {failure && (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-error/40 bg-error/10 px-4 py-3">
          <p className="flex-1 text-sm font-semibold leading-6 text-error">{failure}</p>
          <button type="button" className="button-secondary" onClick={() => post(chat)} disabled={sending}>
            Try again
          </button>
        </div>
      )}

      {chat.done && chat.result ? (
        <div className="mt-5 flex flex-wrap items-center gap-4">
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
        <div className="mt-5">
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
                  : 'Enter to send · Shift+Enter for a new line')}
            </p>
            <button type="button" className="button-primary" onClick={send} disabled={!check.ok || sending}>
              {sending ? 'Sending…' : 'Send'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/** One line from the AI student, with the mascot beside it. */
function Said({ text, muted = false }: { text: string; muted?: boolean }) {
  return (
    <div className="flex items-start gap-3">
      <img
        src={MASCOT}
        alt=""
        width={32}
        height={32}
        className="mt-1 h-8 w-8 shrink-0"
        style={{ imageRendering: 'pixelated' }}
      />
      <p
        className={`max-w-[85%] rounded-xl rounded-bl-sm bg-surface-high px-4 py-3 text-sm leading-6 ${
          muted ? 'text-ink-muted' : 'text-ink'
        }`}
      >
        {text}
      </p>
    </div>
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
    if (error.status === 409) return 'This world is not ready yet.'
    return error.message
  }
  return 'The server could not be reached. Check your connection and try again.'
}
