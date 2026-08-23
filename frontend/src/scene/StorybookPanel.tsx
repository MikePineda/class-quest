/**
 * The reading portal: the theory, in the order it builds.
 *
 * This panel makes no network call and cannot fail. Every byte it renders is
 * already inside the `CourseGraph` the world was loaded with, so opening it is
 * instant and closing it loses nothing — how far the learner has read lives in
 * the caller, not here.
 *
 * It mounts its own `VisualNovelShell`: walking into the gate is arriving
 * somewhere, not opening a dialog box. The storyteller who stands beside the
 * arch on the map is the one talking, and the concept's write-up is their line.
 *
 * Three rules shape the whole file:
 *
 * - **Graph order is teaching order.** `graph.concepts` is already sorted so
 *   that nothing depends on something further down the list. The rail is that
 *   list, unsorted and unfiltered, which is why there is no ordering logic
 *   anywhere below.
 * - **Nothing on screen is written by us.** The label, the write-up, the quotes
 *   and the three lines of each common mistake are generated or extracted
 *   content. Real content is thin — often one common mistake, sometimes no
 *   quote at all — so every field is guarded and a missing one renders nothing.
 *   Connective prose that implies content we do not have is the one thing this
 *   screen must never print.
 * - **A concept carries up to six verbatim quotes and this shows all of them.**
 *   They are the only part of the screen the learner can check against their own
 *   material, so dropping five of six was throwing away the evidence. The first
 *   is open; the rest are one click away, because six blockquotes at once is the
 *   wall of text this redesign exists to kill.
 *
 * Every string here is read by a first-year student who has never seen our
 * docs: the vocabulary of the schema stays in the code and out of the screen.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { BloomLevel, Concept, CourseGraph, Misconception, SourceSpan } from '../api/types'
import { filled, Insight, SourceQuote } from './SceneStages'
import { useCoarsePointer } from './useCoarsePointer'
import { VisualNovelShell } from './vn'
import { portalArt } from './vocabulary'

export interface StorybookPanelProps {
  /** The course content. Null degrades to an empty state, never throws. */
  graph: CourseGraph | null
  /** Concept ids the learner has already opened. */
  readIds: ReadonlySet<string>
  /** Called every time a concept is opened, including the first one shown. */
  onRead: (conceptId: string) => void
  /** World XP as the server knows it. Null shows nothing rather than a zero. */
  xp?: number | null
  onClose: () => void
}

/**
 * What a concept is asking of the reader, from `bloom_level`.
 *
 * A translation of a closed enum into the learner's language, the same job
 * `vocabulary.ts` does for props and biomes — not a claim about the content. The
 * taxonomy's own name never reaches the screen, and neither does the raw value.
 */
const AIM_BY_LEVEL: Record<BloomLevel, string> = {
  remember: 'Read this one to be able to recall it.',
  understand: 'Read this one to be able to put it in your own words.',
  apply: 'Read this one to be able to use it on a new problem.',
  analyse: 'Read this one to be able to pull it apart.',
  evaluate: 'Read this one to be able to judge when it holds.',
  create: 'Read this one to be able to build something with it.',
}

/** Undefined for anything that is not one of the six levels: a bad value says nothing. */
const aimOf = (concept: Concept): string | undefined => AIM_BY_LEVEL[concept.bloom_level]

/**
 * Every quote that actually carries text, in the order the generator wrote them.
 *
 * The strongest span is first, which is why the caller opens on `[0]` — but a
 * concept may carry up to six, and the ones after the first are the reader's
 * only other way back to their own material. Empty spans are dropped so nothing
 * renders a pair of quotation marks around nothing.
 */
const quotesOf = (concept: Concept): SourceSpan[] =>
  concept.source_spans.filter((span) => filled(span.quote))

/** A common mistake with no text in any of its three lines is not worth a panel. */
const speakable = (mistake: Misconception) =>
  filled(mistake.statement) || filled(mistake.why_plausible) || filled(mistake.correction)

export function StorybookPanel({ graph, readIds, onRead, xp = null, onClose }: StorybookPanelProps) {
  const coarse = useCoarsePointer()
  const concepts = useMemo(() => graph?.concepts ?? [], [graph])
  const total = concepts.length
  const [index, setIndex] = useState(0)

  // A world can be reloaded with different content while the portal is open.
  const safeIndex = total === 0 ? 0 : Math.min(index, total - 1)
  const concept = total === 0 ? null : concepts[safeIndex]
  const conceptId = concept?.id ?? null

  /**
   * Opening a concept marks it read.
   *
   * The callback is held in a ref so that a caller passing a fresh closure on
   * every render cannot turn this into a loop: the read is caused by *which*
   * concept is on screen, never by the identity of the handler.
   */
  const readRef = useRef(onRead)
  useEffect(() => {
    readRef.current = onRead
  })
  useEffect(() => {
    if (conceptId !== null) readRef.current(conceptId)
  }, [conceptId])

  // Scrolls the card back to its top when the learner moves on, but only then:
  // doing it on mount would yank the whole overlay as the portal opens.
  const cardRef = useRef<HTMLElement | null>(null)
  const navigated = useRef(false)
  const goTo = useCallback(
    (next: number) => {
      if (total === 0) return
      navigated.current = true
      setIndex(Math.max(0, Math.min(next, total - 1)))
    },
    [total],
  )
  useEffect(() => {
    if (!navigated.current) return
    navigated.current = false
    cardRef.current?.scrollIntoView({ block: 'nearest' })
  }, [safeIndex])

  /** Arrow keys page through, which is what a reader's hands expect. */
  useEffect(() => {
    if (total === 0) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target
      if (target instanceof Element && target.closest('input, textarea, select')) return
      if (event.key === 'ArrowRight') {
        event.preventDefault()
        goTo(safeIndex + 1)
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault()
        goTo(safeIndex - 1)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [goTo, safeIndex, total])

  const readCount = useMemo(
    () => concepts.reduce((sum, entry) => sum + (readIds.has(entry.id) ? 1 : 0), 0),
    [concepts, readIds],
  )

  const byId = useMemo(() => new Map(concepts.map((entry, slot) => [entry.id, slot])), [concepts])

  // An empty graph is possible — a source that yielded nothing still loads a
  // world — and saying so beats a blank page that looks broken.
  if (concept === null) {
    return (
      <VisualNovelShell kind="storybook" title="Nothing to read yet" xp={xp} onClose={onClose}>
        <p className="leading-7 text-ink-muted">
          Nothing was pulled out of your notes for this world yet, so there is nothing to read here. Regenerate the
          world to try again.
        </p>
        <button className="button-primary mt-6" onClick={onClose}>
          Back to the hub
        </button>
      </VisualNovelShell>
    )
  }

  const art = portalArt('storybook')
  const sourceTitle = graph && filled(graph.source.title) ? graph.source.title : null
  const quotes = quotesOf(concept)
  const mistakes = concept.misconceptions.filter(speakable)
  const summary = filled(concept.summary) ? concept.summary : null
  const bare = summary === null && quotes.length === 0 && mistakes.length === 0
  const isFirst = safeIndex === 0
  const isLast = safeIndex === total - 1

  // Only the prerequisites that resolve to something in this world. An id with
  // no concept behind it is a dangling reference, not a reading suggestion.
  const builtOn = concept.prerequisites
    .map((id) => {
      const slot = byId.get(id)
      return slot === undefined ? null : { slot, label: concepts[slot].label }
    })
    .filter((entry): entry is { slot: number; label: string } => entry !== null)

  return (
    <VisualNovelShell
      kind="storybook"
      title={concept.label}
      subtitle={aimOf(concept)}
      progress={{ done: readCount, total, label: 'read' }}
      xp={xp}
      speaker={{ actor: 'villager' }}
      // The write-up is what the storyteller says. Blank omits the whole band
      // rather than putting an empty speech bubble on the screen.
      dialogue={summary ?? undefined}
      footerHint={coarse ? 'Use Previous and Next to turn the page.' : 'Arrow keys ← and → turn the page.'}
      onClose={onClose}
      closeLabel="Back to the hub"
    >
      <div className="grid gap-6 sm:grid-cols-[minmax(9rem,12rem)_1fr]">
        {/* The rail is the course, in the order it builds. Nothing is locked:
            skipping ahead is allowed, it just is not the order it was written in. */}
        <nav aria-label="What this world covers">
          <p className="eyebrow text-ink-muted">In the order it builds</p>
          <ol className="mt-3 space-y-1.5">
            {concepts.map((entry, slot) => {
              const current = slot === safeIndex
              const seen = readIds.has(entry.id)
              const tone = current
                ? 'border-secondary bg-secondary/10 text-ink'
                : seen
                  ? 'border-white/10 bg-surface-high/60 text-ink-muted hover:border-white/25'
                  : 'border-white/10 bg-surface-high/30 text-ink-muted hover:border-white/25'
              return (
                <li key={entry.id}>
                  <button
                    type="button"
                    className={`flex w-full items-start gap-2 rounded-xl border px-3 py-2 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary ${tone}`}
                    aria-current={current ? 'true' : undefined}
                    onClick={() => goTo(slot)}
                  >
                    <span
                      aria-hidden="true"
                      className={`mt-0.5 shrink-0 font-mono text-xs font-bold ${current ? 'text-secondary' : 'text-ink-muted/70'}`}
                    >
                      {slot + 1}
                    </span>
                    <span className="text-sm font-semibold leading-5">{entry.label}</span>
                    {seen && (
                      <span className="ml-auto text-xs font-black text-secondary">
                        <span aria-hidden="true">✓</span>
                        <span className="sr-only">Read</span>
                      </span>
                    )}
                  </button>
                </li>
              )
            })}
          </ol>
        </nav>

        <article key={concept.id} ref={cardRef} className="min-w-0 scroll-mt-2">
          {/* Where this one sits in the chain. The names are the learner's own
              material and the jump is the fastest way back to them. */}
          {builtOn.length > 0 && (
            <div className="flex flex-wrap items-baseline gap-2">
              <p className="eyebrow text-ink-muted">Builds on</p>
              {builtOn.map((entry) => (
                <button
                  key={entry.slot}
                  type="button"
                  className="rounded-lg border border-white/12 bg-surface-high px-2.5 py-1 text-xs font-bold text-ink-muted transition hover:border-white/30 hover:text-ink"
                  onClick={() => goTo(entry.slot)}
                >
                  {entry.label}
                </button>
              ))}
            </div>
          )}

          {summary === null && (
            <p className="mt-4 max-w-prose leading-7 text-ink-muted">No write-up was saved for this one.</p>
          )}

          {/* Verbatim from the upload. It is here because the learner can check
              it against their own material — which is why we never paraphrase
              it and never print the block without one. */}
          {quotes.length > 0 && (
            <div className="mt-6">
              <SourceQuotes key={concept.id} quotes={quotes} title={sourceTitle} />
            </div>
          )}

          {mistakes.length > 0 && (
            <div className="mt-7">
              <p className="eyebrow text-ink-muted">
                {mistakes.length === 1 ? 'Where people trip up' : `Where people trip up · ${mistakes.length}`}
              </p>
              <div className="mt-3 space-y-5">
                {mistakes.map((mistake) => (
                  <div key={mistake.id} className="space-y-3">
                    {filled(mistake.statement) && (
                      <Insight label="A common mistake" text={mistake.statement} tone="amber" />
                    )}
                    {filled(mistake.why_plausible) && (
                      <Insight label="Why that's tempting" text={mistake.why_plausible} />
                    )}
                    {filled(mistake.correction) && (
                      <Insight label="What's actually true" text={mistake.correction} tone="teal" />
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Only reachable when the label is genuinely all that was saved.
              Stating that is honest; writing a paragraph to fill the space
              would be indistinguishable from grounded content. */}
          {bare && (
            <p className="mt-4 max-w-prose leading-7 text-ink-muted">
              Nothing else was saved for this one — no lines from your notes, and no common mistakes.
            </p>
          )}

          <div className="mt-8 flex flex-wrap items-center gap-3 border-t border-white/10 pt-6">
            <button className="button-secondary" onClick={() => goTo(safeIndex - 1)} disabled={isFirst}>
              Previous
            </button>
            {isLast ? (
              <button className="button-primary" onClick={onClose}>
                Back to the hub
              </button>
            ) : (
              <button className="button-primary" onClick={() => goTo(safeIndex + 1)}>
                Next
              </button>
            )}
            <p className="ml-auto font-hud text-[11px]" style={{ color: art.rim }}>
              {safeIndex + 1} / {total}
            </p>
          </div>
        </article>
      </div>
    </VisualNovelShell>
  )
}

/**
 * Every line the generator kept from the upload for this concept.
 *
 * The first is always open — it is the one the generator ranked strongest, and
 * a reader who wants one piece of evidence wants that one. The rest are behind
 * a control that says exactly how many there are, so the count is honest whether
 * or not anybody opens it. There is one of these per concept, keyed by the
 * concept, so turning the page closes it again.
 */
function SourceQuotes({ quotes, title }: { quotes: readonly SourceSpan[]; title: string | null }) {
  const [expanded, setExpanded] = useState(false)
  const rest = quotes.length - 1
  const shown = expanded ? quotes : quotes.slice(0, 1)

  return (
    <div>
      <div className="space-y-3">
        {shown.map((span, i) => (
          <SourceQuote key={`${span.segment_id}-${i}`} quote={span.quote} segment={span.segment_id} title={title} />
        ))}
      </div>
      {rest > 0 && (
        <button
          type="button"
          className="button-secondary mt-3"
          aria-expanded={expanded}
          onClick={() => setExpanded((open) => !open)}
        >
          {expanded
            ? `Hide the other ${rest === 1 ? 'line' : `${rest} lines`}`
            : `Show ${rest === 1 ? '1 more line' : `${rest} more lines`} from your notes`}
        </button>
      )}
    </div>
  )
}
