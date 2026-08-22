/**
 * The reading portal: the theory, in the order it builds.
 *
 * This panel makes no network call and cannot fail. Every byte it renders is
 * already inside the `CourseGraph` the world was loaded with, so opening it is
 * instant and closing it loses nothing — how far the learner has read lives in
 * the caller, not here.
 *
 * Two rules shape the whole file:
 *
 * - **Graph order is teaching order.** `graph.concepts` is already sorted so
 *   that nothing depends on something further down the list. The rail is that
 *   list, unsorted and unfiltered, which is why there is no ordering logic
 *   anywhere below.
 * - **Nothing on screen is written by us.** The label, the write-up, the quote
 *   and the three lines of each common mistake are generated or extracted
 *   content. Real content is thin — often one common mistake, sometimes no
 *   quote at all — so every field is guarded and a missing one renders nothing.
 *   Connective prose that implies content we do not have is the one thing this
 *   screen must never print.
 *
 * Every string here is read by a first-year student who has never seen our
 * docs: the vocabulary of the schema stays in the code and out of the screen.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Concept, CourseGraph, Misconception } from '../api/types'
import { filled, Insight, SourceQuote } from './SceneStages'
import type { SourceQuoteProps } from './SceneStages'

export interface StorybookPanelProps {
  /** The course content. Null degrades to an empty state, never throws. */
  graph: CourseGraph | null
  /** Concept ids the learner has already opened. */
  readIds: ReadonlySet<string>
  /** Called every time a concept is opened, including the first one shown. */
  onRead: (conceptId: string) => void
  onClose: () => void
}

/**
 * The first quote that actually carries text, with its place in the upload.
 *
 * The generator writes the strongest span first, so this is `source_spans[0]`
 * in every real artifact; scanning past an empty one only avoids rendering a
 * pair of quotation marks around nothing.
 */
const quoteOf = (concept: Concept, title: string | null): SourceQuoteProps | null => {
  const span = concept.source_spans.find((candidate) => filled(candidate.quote))
  return span ? { quote: span.quote, segment: span.segment_id, title } : null
}

/** A common mistake with no text in any of its three lines is not worth a panel. */
const speakable = (mistake: Misconception) =>
  filled(mistake.statement) || filled(mistake.why_plausible) || filled(mistake.correction)

export function StorybookPanel({ graph, readIds, onRead, onClose }: StorybookPanelProps) {
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

  // An empty graph is possible — a source that yielded nothing still loads a
  // world — and saying so beats a blank page that looks broken.
  if (concept === null) {
    return (
      <div>
        <p className="leading-7 text-ink-muted">
          Nothing was pulled out of your notes for this world yet, so there is nothing to read here. Regenerate the
          world to try again.
        </p>
        <button className="button-primary mt-6" onClick={onClose}>
          Back to the hub
        </button>
      </div>
    )
  }

  const sourceTitle = graph && filled(graph.source.title) ? graph.source.title : null
  const quote = quoteOf(concept, sourceTitle)
  const mistakes = concept.misconceptions.filter(speakable)
  const summary = filled(concept.summary) ? concept.summary : null
  const bare = summary === null && quote === null && mistakes.length === 0
  const isFirst = safeIndex === 0
  const isLast = safeIndex === total - 1

  return (
    <div>
      {/* Where you are and how much is left, before any of the reading. */}
      <div className="border-b border-white/10 pb-5">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-ink-muted">
            {safeIndex + 1} of {total}
          </p>
          <p className="ml-auto text-xs font-bold text-secondary" aria-live="polite">
            {readCount} of {total} read
          </p>
        </div>
        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-surface-high">
          <div
            className="h-full rounded-full bg-secondary transition-all duration-300"
            style={{ width: `${total === 0 ? 0 : (readCount / total) * 100}%` }}
          />
        </div>
      </div>

      <div className="mt-6 grid gap-6 sm:grid-cols-[minmax(9rem,12rem)_1fr]">
        {/* The rail is the course, in the order it builds. Nothing is locked:
            skipping ahead is allowed, it just is not the order it was written in. */}
        <nav aria-label="What this world covers">
          <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-ink-muted">In the order it builds</p>
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

        <article key={concept.id} ref={cardRef} className="stage-enter scroll-mt-2">
          <h3 className="text-2xl font-black leading-tight text-ink sm:text-3xl">{concept.label}</h3>

          {summary ? (
            <p className="mt-4 max-w-prose text-base leading-8 text-ink">{summary}</p>
          ) : (
            <p className="mt-4 max-w-prose leading-7 text-ink-muted">
              No write-up was saved for this one.
            </p>
          )}

          {/* Verbatim from the upload. It is here because the learner can check
              it against their own material — which is why we never paraphrase
              it and never print the block without one. */}
          {quote && (
            <div className="mt-6">
              <SourceQuote quote={quote.quote} segment={quote.segment} title={quote.title} />
            </div>
          )}

          {mistakes.length > 0 && (
            <div className="mt-7">
              <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-ink-muted">
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
            <p className="ml-auto text-xs font-semibold text-ink-muted">
              Arrow keys <kbd className="font-mono text-ink">←</kbd> <kbd className="font-mono text-ink">→</kbd> also
              turn the page.
            </p>
          </div>
        </article>
      </div>
    </div>
  )
}
