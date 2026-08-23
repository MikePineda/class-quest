/**
 * The reading portal: the course as the story it was written as.
 *
 * ## What changed, and why
 *
 * This panel used to page through `graph.concepts` — a definition, its quotes
 * and its common mistakes, one concept at a time. Everything on it was true and
 * none of it was a story, which is exactly what a learner walking through a
 * glowing arch expects to find on the other side.
 *
 * The story was already in the payload. Every quest carries chapters with their
 * own titles, a biome, a narrator and dialogue whose lines are prose written
 * from the learner's own material — "Every crate in this village wears a label,
 * and every label can be peeled off and stuck on another crate." Since the hub
 * redesign the quest is not walkable, so all of that has been shipped to the
 * browser and never shown. `storybook.ts` is the join, and this file is what it
 * looks like: the chapter's room across the top, the narration delivered a line
 * at a time by whoever the chapter says is talking, and the concepts that
 * chapter teaches underneath, still with their quotes and their mistakes.
 *
 * ## The rules that did not change
 *
 * - **Nothing on screen is written by us.** Titles, narration, write-ups,
 *   quotes and mistakes are all generated or extracted content. Real content is
 *   thin — often one common mistake, sometimes no quote at all — so every field
 *   is guarded and a missing one renders nothing. Connective prose that implies
 *   content we do not have is the one thing this screen must never print. The
 *   only strings this file owns are about *reading*: which page you are on, and
 *   what a button does.
 * - **Content order is teaching order.** Chapters are in the order the quest
 *   wrote them and concepts in the order the graph did, and there is no sorting
 *   anywhere below.
 * - **It makes no network call and cannot fail.** Every byte is already in the
 *   world the panel was handed, so opening it is instant and closing it loses
 *   nothing.
 * - **A concept carries up to six verbatim quotes and this shows all of them.**
 *   The first is open, the rest are one click away.
 *
 * Every string here is read by a first-year student who has never seen our
 * docs: the vocabulary of the schema stays in the code and out of the screen.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { BloomLevel, Concept, CourseGraph, Game, Misconception, SourceSpan } from '../api/types'
import { filled, Insight, SourceQuote } from './SceneStages'
import type { StoryPage } from './storybook'
import { buildStory, pageRead } from './storybook'
import { StoryStage } from './StoryStage'
import { useCoarsePointer } from './useCoarsePointer'
import { VisualNovelShell } from './vn'
import { portalArt } from './vocabulary'

export interface StorybookPanelProps {
  /** The course content. Null degrades to an empty state, never throws. */
  graph: CourseGraph | null
  /**
   * The quest, which is where the narration and the rooms live. Null or
   * chapterless degrades to one page per concept — what this panel showed
   * before it learned about chapters.
   */
  quest?: Game | null
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

export function StorybookPanel({ graph, quest = null, readIds, onRead, xp = null, onClose }: StorybookPanelProps) {
  const coarse = useCoarsePointer()
  const pages = useMemo(() => buildStory(graph, quest), [graph, quest])
  const total = pages.length
  const [index, setIndex] = useState(0)

  // A world can be reloaded with different content while the portal is open.
  const safeIndex = total === 0 ? 0 : Math.min(index, total - 1)
  const page: StoryPage | null = total === 0 ? null : pages[safeIndex]

  /**
   * How much of this page's narration has been delivered.
   *
   * Beats arrive one at a time because that is what makes it a scene rather
   * than a wall of prose — but a page whose ideas the learner has already read
   * opens with all of it, so coming back to look something up is not a click
   * count. Keyed off the page id, so turning the page starts the next one over.
   */
  //
  // Whether the page was *already* read when the learner arrived at it — not
  // whether it is read now. Opening a page marks everything on it read, so
  // asking `readIds` live would make every page already-read the instant it
  // appeared and no chapter would ever be narrated at all.
  //
  // Recorded by adjusting state during render rather than in an effect: an
  // effect runs after the paint, so the first frame of every page would show
  // the whole chapter and then collapse back to its first line.
  const [arrival, setArrival] = useState<{ id: string; whole: boolean } | null>(null)
  const arrived = page !== null && arrival?.id === page.id
  if (page !== null && !arrived) setArrival({ id: page.id, whole: pageRead(page, readIds) })
  const opensWhole = arrived ? arrival!.whole : page !== null && pageRead(page, readIds)
  const [beat, setBeat] = useState(0)
  const shownBeats = opensWhole ? (page?.beats.length ?? 0) : Math.min(beat + 1, page?.beats.length ?? 0)
  const beatsLeft = (page?.beats.length ?? 0) - shownBeats
  // The material is what the page is for; the narration is how you arrive at
  // it. It appears once the narration is done, and immediately when there is
  // none — never behind a click the learner has to guess at.
  const revealed = beatsLeft <= 0

  /**
   * Opening a page marks everything it teaches as read.
   *
   * The callback is held in a ref so that a caller passing a fresh closure on
   * every render cannot turn this into a loop: the read is caused by *which*
   * page is on screen, never by the identity of the handler.
   */
  const readRef = useRef(onRead)
  useEffect(() => {
    readRef.current = onRead
  })
  const conceptIdsOnPage = page?.concepts.map((concept) => concept.id).join(',') ?? ''
  useEffect(() => {
    if (!conceptIdsOnPage) return
    for (const id of conceptIdsOnPage.split(',')) readRef.current(id)
  }, [conceptIdsOnPage])

  // Scrolls the card back to its top when the learner moves on, but only then:
  // doing it on mount would yank the whole overlay as the portal opens.
  const cardRef = useRef<HTMLElement | null>(null)
  const navigated = useRef(false)
  const goTo = useCallback(
    (next: number) => {
      if (total === 0) return
      navigated.current = true
      setBeat(0)
      setIndex(Math.max(0, Math.min(next, total - 1)))
    },
    [total],
  )
  useEffect(() => {
    if (!navigated.current) return
    navigated.current = false
    cardRef.current?.scrollIntoView({ block: 'nearest' })
  }, [safeIndex])

  /** One more line of narration, or the next page once there is none left. */
  const advance = useCallback(() => {
    if (beatsLeft > 0) setBeat((current) => current + 1)
    else goTo(safeIndex + 1)
  }, [beatsLeft, goTo, safeIndex])

  /** Arrow keys page through, which is what a reader's hands expect. */
  useEffect(() => {
    if (total === 0) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target
      if (target instanceof Element && target.closest('input, textarea, select')) return
      if (event.key === 'ArrowRight') {
        event.preventDefault()
        advance()
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault()
        goTo(safeIndex - 1)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [advance, goTo, safeIndex, total])

  const readCount = useMemo(
    () => pages.reduce((sum, entry) => sum + (pageRead(entry, readIds) ? 1 : 0), 0),
    [pages, readIds],
  )

  // An empty graph is possible — a source that yielded nothing still loads a
  // world — and saying so beats a blank page that looks broken.
  if (page === null) {
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
  const isFirst = safeIndex === 0
  const isLast = safeIndex === total - 1
  // The narrator's current line. A page with no narration falls back to the
  // write-up of what it teaches, which is what this panel always spoke.
  const line =
    page.beats.length > 0
      ? page.beats[Math.max(0, shownBeats - 1)]
      : (page.concepts.find((concept) => filled(concept.summary))?.summary ?? undefined)

  // With one concept, its name is already the chapter title, so repeating it
  // as a heading is noise.
  const single = page.concepts.length === 1
  // ...and when there is no narration either, the write-up *is* the line the
  // storyteller is saying, so the notes must not print it a second time. A
  // chapter that narrates does not have that problem: its line is the story.
  const summaryIsSpoken = single && page.beats.length === 0

  return (
    <VisualNovelShell
      kind="storybook"
      title={page.title}
      // Where you are in the book. It is about the reading, not the content.
      subtitle={total > 1 ? `Chapter ${safeIndex + 1} of ${total}` : undefined}
      progress={{ done: readCount, total, label: 'read' }}
      xp={xp}
      speaker={{ actor: page.narrator }}
      dialogue={line}
      illustration={
        <StoryStage background={page.background} props={page.props} caption={page.title} accent={art.rim} />
      }
      footerHint={
        beatsLeft > 0
          ? coarse
            ? 'Tap Continue to hear the rest.'
            : 'Press → or Continue to hear the rest.'
          : coarse
            ? 'Use Previous and Next to turn the page.'
            : 'Arrow keys ← and → turn the page.'
      }
      onClose={onClose}
      closeLabel="Back to the hub"
    >
      <div className="grid gap-6 sm:grid-cols-[minmax(9rem,13rem)_1fr]">
        {/* The rail is the book's contents, in the order it was written.
            Nothing is locked: skipping ahead is allowed, it just is not the
            order it was told in. */}
        <nav aria-label="What this world covers">
          <p className="eyebrow text-ink-muted">In the order it happens</p>
          <ol className="mt-3 space-y-1.5">
            {pages.map((entry, slot) => {
              const current = slot === safeIndex
              const seen = pageRead(entry, readIds)
              const tone = current
                ? 'border-secondary bg-secondary/10 text-ink'
                : 'border-white/10 bg-surface-high/40 text-ink-muted hover:border-white/25'
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
                    <span className="min-w-0 text-sm font-semibold leading-5">{entry.title}</span>
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

        <article key={page.id} ref={cardRef} className="min-w-0 scroll-mt-2">
          {/* The notes are what the page is for; while the chapter is still
              being told there is nothing here but the story. */}
          {revealed &&
            page.concepts.map((concept) => (
              <ConceptNotes
                key={concept.id}
                concept={concept}
                sourceTitle={sourceTitle}
                heading={!single}
                showSummary={!summaryIsSpoken}
              />
            ))}

          {/* A chapter that only narrates. Saying so is honest; writing a
              paragraph to fill the space would be indistinguishable from
              grounded content. */}
          {revealed && page.concepts.length === 0 && (
            <p className="max-w-prose leading-7 text-ink-muted">
              This part of the story does not introduce a new idea — it sets up the ones on either side of it.
            </p>
          )}

          {/* One bar, whatever the page is doing. Two of them — a "Continue"
              for the story and a "Next" for the page — read as two different
              forwards, and the reader has to work out which one they meant. */}
          <div
            className={`flex flex-wrap items-center gap-3 ${revealed ? 'mt-8 border-t border-white/10 pt-6' : ''}`}
          >
            <button className="button-secondary" onClick={() => goTo(safeIndex - 1)} disabled={isFirst}>
              Previous
            </button>
            {isLast && revealed ? (
              <button className="button-primary" onClick={onClose}>
                Back to the hub
              </button>
            ) : (
              <button className="button-primary" onClick={advance}>
                {beatsLeft > 0 ? 'Continue' : 'Next'}
              </button>
            )}
            {/* The way out of the story, for a reader who came back to look
                something up rather than to be told it again. */}
            {beatsLeft > 0 && (
              <button className="button-secondary" onClick={() => setBeat(page.beats.length)}>
                Skip to the notes
              </button>
            )}
            <p className="ml-auto font-hud text-[11px]" style={{ color: art.rim }}>
              {beatsLeft > 0
                ? `${shownBeats} / ${page.beats.length}`
                : `${safeIndex + 1} / ${total}`}
            </p>
          </div>
        </article>
      </div>
    </VisualNovelShell>
  )
}

/**
 * One idea's notes: the write-up, the lines it came from, and where people
 * trip up. Every block is guarded — real content is thin, and a heading over
 * nothing is worse than no heading.
 */
function ConceptNotes({
  concept,
  sourceTitle,
  heading,
  showSummary,
}: {
  concept: Concept
  sourceTitle: string | null
  /** Its own name above it. Off when the page title already is that name. */
  heading: boolean
  /** Off only when the storyteller is currently saying this write-up. */
  showSummary: boolean
}) {
  const quotes = quotesOf(concept)
  const mistakes = concept.misconceptions.filter(speakable)
  const summary = filled(concept.summary) ? concept.summary : null
  const bare = summary === null && quotes.length === 0 && mistakes.length === 0
  const aim = aimOf(concept)

  return (
    <section className="mb-8 last:mb-0">
      {heading && (
        <header className="mb-3">
          <h3 className="text-base font-black tracking-tight text-ink">{concept.label}</h3>
          {aim && <p className="text-xs font-semibold text-ink-muted">{aim}</p>}
        </header>
      )}

      {showSummary && summary && <p className="max-w-prose leading-7 text-ink">{summary}</p>}

      {summary === null && (
        <p className="max-w-prose leading-7 text-ink-muted">No write-up was saved for this one.</p>
      )}

      {/* Verbatim from the upload. It is here because the learner can check it
          against their own material — which is why we never paraphrase it and
          never print the block without one. */}
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

      {/* Only reachable when the label is genuinely all that was saved. */}
      {bare && (
        <p className="max-w-prose leading-7 text-ink-muted">
          Nothing else was saved for this one — no lines from your notes, and no common mistakes.
        </p>
      )}
    </section>
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
