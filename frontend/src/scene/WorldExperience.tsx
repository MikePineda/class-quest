/**
 * The world screen: a generated course, walked.
 *
 * The canvas owns the pixels and `usePlayer` owns the walking; this file owns
 * the meaning — which gate the player is standing in front of, whether it is
 * open, and what the learner is told once they step through.
 *
 * The world is a hub: the player stands in the middle of one cave room with
 * three glowing portals around them, each a different mode of learning
 * (storybook, quiz, explain), plus a fourth that renders sealed. Clearing all
 * three clears the world. The portals carry no content of their own — the panel
 * behind each one reads the Game or the CourseGraph directly — which is why
 * `hubgen` only ever needs labels and a locked flag.
 *
 * A portal whose content is missing renders **locked** rather than opening an
 * empty panel: a door that will not budge is honest, a door onto nothing is a
 * bug the audience can see.
 *
 * Three ways in. With a `worldId` it loads the learner's real world through
 * `api.getWorld` and builds the hub from `games.quest` (+ `games.gauntlet` and
 * `graph`, which is where misconceptions and source quotes live). Without one it
 * shows `WorldPicker`, because otherwise a generated world is only reachable by
 * typing its id into the address bar. `/world?demo=1` walks the bundled fixture,
 * the offline safety net for the pitch. The fixture is never used as a fallback
 * for a real world that failed to load: showing somebody else's course while
 * they asked for their own is worse than an honest error.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, ApiError } from '../api/client'
import type {
  AttemptOut,
  CourseGraph,
  ExplainOut,
  Game,
  Option,
  PredictionScene,
  Scene,
  SceneProgress,
} from '../api/types'
import { fixtureGauntlet, fixtureGraph, fixtureQuest } from '../fixtures'
import { clearedPortals, worldCleared } from './gating'
import { buildHub } from './hubgen'
import type { HubPortalSpec } from './hubgen'
import { conceptTrail, diagnose } from './pedagogy'
import { ExplainPanel } from './ExplainPanel'
import { QuizPanel } from './QuizPanel'
import { StorybookPanel } from './StorybookPanel'
import {
  DiagnosisStage,
  EvidenceStage,
  filled,
  humanise,
  Notice,
  PredictionStage,
} from './SceneStages'
import type { Persistence, SceneOutcome, Stage } from './SceneStages'
import type { Point, PortalKind, PortalNode, Rect, WorldMap } from './types'
import { usePlayer } from './usePlayer'
import { portalArt } from './vocabulary'
import { WorldCanvas } from './WorldCanvas'
import { WorldConceptTrail } from './WorldConceptTrail'
import { FIXTURE_HREF, WorldPicker } from './WorldPicker'

/**
 * `games.quest` is nullable: the backend persists a world whose generation only
 * partly succeeded. That is a state of its own, not a network failure, and it
 * gets its own screen. `gauntlet` and `graph` are nullable too, and are carried
 * rather than dropped: the gauntlet is the quiz gate's only question source and
 * the graph is where misconceptions and source quotes live, so a portal without
 * its half of the content is exactly what `locked` is for.
 */
type Load =
  | { status: 'loading' }
  | { status: 'ready'; game: Game; gauntlet: Game | null; graph: CourseGraph | null }
  | { status: 'picker' }
  | { status: 'empty'; title: string }
  | { status: 'error'; message: string; needsSignIn: boolean }

/** Standing anywhere inside a portal's hotspot counts as standing at the portal. */
const inRect = (r: Rect, t: Point): boolean =>
  t.x >= r.x && t.x < r.x + r.w && t.y >= r.y && t.y < r.y + r.h

/**
 * Every hub looks the same on purpose: one recognisable room the audience learns
 * in the first ten seconds and never has to re-read. One line to change if the
 * team wants per-world biomes back.
 */
const HUB_BACKGROUND = 'cavern' as const

/**
 * Where "leave" goes: the picker, which is the screen this world was chosen
 * from and the one that lists every other world. Navigation in this app is a
 * plain full page load — there is no router — so this is an `href`, and the
 * keyboard path below sets `window.location` rather than pushing history.
 */
const LEAVE_HREF = '/world'

/**
 * Everything the learner accumulates inside one world, carried in a single
 * value keyed by the world it belongs to. Switching worlds then resets it
 * during render, the way `fetched` already does, instead of through an effect
 * that would fire a second render for a value nothing had read yet.
 */
interface Session {
  key: string | undefined
  completed: ReadonlySet<string>
  /**
   * Scenes the learner actually got right. "Walked" and "understood" are
   * different claims, and only this one may be read as mastery: a learner who
   * answered every scene wrong has still walked them all. Correctness is
   * sticky, mirroring the server's `best_correct` — a scene answered right on
   * one attempt stays right, so ids are only ever added here, never removed.
   */
  correct: ReadonlySet<string>
  /** What was committed in this session, keyed by scene id. Read by `QuizPanel`. */
  outcomes: Record<string, SceneOutcome>
  /** Server-side history, so a reload does not erase what the learner already did. */
  restored: Record<string, SceneProgress>
  /**
   * Concepts the learner has already explained well enough to be recorded.
   * Written by the server, so this is the one portal whose progress is real —
   * the explain gate opens on the first concept not in here.
   */
  explained: ReadonlySet<string>
  /**
   * Concepts whose storybook page has been opened. The server has no field for
   * this, so it is a browser-side read receipt and nothing more: it records
   * that a page was on screen, never that it was understood. It survives a
   * reload through `localStorage` only — see `readStorage`.
   */
  read: ReadonlySet<string>
  /** World XP as the server knows it. Null means there is nothing honest to show. */
  xp: number | null
}

/** One entry per world, so opening another course cannot inherit its reading. */
const readStorageKey = (worldId: string) => `cq.portals.${worldId}`

/**
 * Reading progress from a previous visit.
 *
 * Every path returns a set: a private window throws on `localStorage`, blocked
 * site data returns null, and a hand-edited entry can be any JSON at all. None
 * of those may stop a world from rendering, so all of them read as "nothing
 * read yet". The fixture world has no id and is never persisted.
 */
function loadRead(worldId: string | undefined): ReadonlySet<string> {
  if (!worldId) return new Set<string>()
  try {
    const raw = window.localStorage.getItem(readStorageKey(worldId))
    if (!raw) return new Set<string>()
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return new Set<string>()
    return new Set(parsed.filter((entry): entry is string => typeof entry === 'string'))
  } catch {
    return new Set<string>()
  }
}

/** Best effort: losing the receipt costs a re-read, and never a broken world. */
function saveRead(worldId: string | undefined, read: ReadonlySet<string>): void {
  if (!worldId) return
  try {
    window.localStorage.setItem(readStorageKey(worldId), JSON.stringify([...read]))
  } catch {
    /* no storage in this browser session; the reading still works, it just does not survive */
  }
}

const freshSession = (key: string | undefined): Session => ({
  key,
  completed: new Set<string>(),
  correct: new Set<string>(),
  outcomes: {},
  restored: {},
  explained: new Set<string>(),
  // Hydrated here rather than in an effect so the first render already has it:
  // an effect would have to race the effect that writes the set back.
  read: loadRead(key),
  xp: null,
})

function describe(error: unknown): { message: string; needsSignIn: boolean } {
  if (error instanceof ApiError) {
    if (error.status === 401) {
      return { message: 'You are not signed in, so this world cannot be loaded.', needsSignIn: true }
    }
    if (error.status === 403) {
      return { message: 'This world belongs to a server you have not joined.', needsSignIn: false }
    }
    if (error.status === 404) {
      return { message: 'No world with that id. It may have been deleted.', needsSignIn: false }
    }
    return { message: error.message, needsSignIn: false }
  }
  return { message: 'The world could not be reached. Check the connection and try again.', needsSignIn: false }
}

export interface WorldExperienceProps {
  /** Omitted means the picker (or the fixture, with `?demo` on the URL). */
  worldId?: string
}

export function WorldExperience({ worldId }: WorldExperienceProps) {
  // Keyed by the id it was fetched for: a different id reads as "loading"
  // during render rather than through a synchronous reset in the effect.
  const [fetched, setFetched] = useState<{ id: string | undefined; value: Load } | null>(null)
  // Read once per render: the router is the URL, so a flag on it is the only
  // state that survives the full page load a link causes.
  const walksFixture = new URLSearchParams(window.location.search).has('demo')
  const load: Load =
    fetched && fetched.id === worldId
      ? fetched.value
      : worldId
        ? { status: 'loading' }
        : walksFixture
          ? // The fixture ships its own graph and gauntlet, so the offline demo
            // opens all three gates.
            { status: 'ready', game: fixtureQuest, gauntlet: fixtureGauntlet, graph: fixtureGraph }
          : { status: 'picker' }

  const [stored, setStored] = useState<Session>(() => freshSession(worldId))
  const session = stored.key === worldId ? stored : freshSession(worldId)
  const { completed, correct, explained, read, xp } = session
  const [openPortal, setOpenPortal] = useState<PortalKind | null>(null)

  /** Patch the session, discarding whatever belonged to a world we left. */
  const updateSession = useCallback(
    (patch: (current: Session) => Partial<Session> | null) => {
      setStored((current) => {
        const base = current.key === worldId ? current : freshSession(worldId)
        const next = patch(base)
        return next ? { ...base, ...next } : base
      })
    },
    [worldId],
  )

  useEffect(() => {
    if (!worldId) return
    let cancelled = false
    api
      .getWorld(worldId)
      .then((detail) => {
        if (cancelled) return
        const quest = detail.games.quest
        // A world can be persisted with only part of its generation done.
        if (!quest) {
          setFetched({ id: worldId, value: { status: 'empty', title: detail.title } })
          return
        }
        updateSession(() => ({
          xp: detail.my_progress.xp,
          explained: new Set(detail.my_progress.explained_concept_ids),
        }))
        setFetched({
          id: worldId,
          value: { status: 'ready', game: quest, gauntlet: detail.games.gauntlet, graph: detail.graph },
        })
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setFetched({ id: worldId, value: { status: 'error', ...describe(error) } })
      })

    // Progress is a separate request on purpose: losing the history is a worse
    // session, but it is not a reason to refuse to render the world.
    api
      .getProgress(worldId)
      .then((progress) => {
        if (cancelled) return
        // The gauntlet, not the quest: the quiz gate is the only thing the
        // learner can answer on a hub map, and it posts its attempts under
        // `archetype: 'gauntlet'` (see `commit` below). Restoring the quest
        // instead would leave every answered question looking untouched.
        const answered = progress.scenes.filter((scene) => scene.archetype === 'gauntlet')
        // "Done" means walked, not necessarily right: the loop finishes with the
        // diagnosis, and a scene the learner got wrong is still behind them.
        // Mastery is the other set, and it is seeded from `best_correct` rather
        // than from having attempted: the server already remembers the best
        // attempt, so a scene fixed on the second try comes back right.
        updateSession((current) => ({
          completed: new Set(answered.map((scene) => scene.scene_id)),
          // Unioned, not replaced: this reply can land after a commit the
          // learner already made, and correctness never goes backwards.
          correct: new Set([
            ...current.correct,
            ...answered.filter((scene) => scene.best_correct).map((scene) => scene.scene_id),
          ]),
          // Keyed by the plain scene id, which assumes ids do not collide
          // between the quest and the gauntlet. The fixtures use disjoint
          // prefixes (`sc_*` and `g_*`) but that is a convention of the
          // generator, not something either schema guarantees — key this map by
          // `archetype + scene_id` the day a generated world proves it wrong.
          restored: Object.fromEntries(answered.map((scene) => [scene.scene_id, scene])),
          // Unioned for the same reason `correct` is: this reply can land after
          // a conversation the learner just finished, and explaining something
          // is never undone.
          explained: new Set([
            ...current.explained,
            ...progress.explanations
              .filter((record) => record.verdict !== 'fail')
              .map((record) => record.concept_id),
          ]),
          xp: progress.xp,
        }))
      })
      .catch(() => {
        /* history unavailable; the world still walks */
      })

    return () => {
      cancelled = true
    }
  }, [worldId, updateSession])

  const game = load.status === 'ready' ? load.game : null
  const gauntlet = load.status === 'ready' ? load.gauntlet : null
  const graph = load.status === 'ready' ? load.graph : null

  /**
   * The four gates, in slot order — `hubgen` maps them onto its anchors by index.
   *
   * This MUST stay memoised. An inline array literal is a new object on every
   * render, which makes `buildHub` rerun, which makes a new `map` identity, and
   * then two unrelated things break silently: `usePlayer`'s `[map]` effect resets
   * the player to spawn (reads as "the character cannot move") and
   * `WorldCanvas`'s preload identity check never settles (reads as "the world
   * never finishes loading"). Neither symptom points here.
   */
  const portalSpecs = useMemo<HubPortalSpec[]>(
    () => [
      {
        kind: 'storybook',
        label: 'Storybook',
        blurb: 'Read the ideas, in the order they build on each other.',
        // No concepts means nothing to read. Locked beats an empty book.
        locked: !graph || graph.concepts.length === 0,
      },
      {
        kind: 'quiz',
        label: 'Quiz',
        blurb: 'Answer questions and see where you went wrong.',
        // The gauntlet is the only question source; degraded worlds have none.
        locked: !gauntlet,
      },
      {
        kind: 'explain',
        label: 'Explain to Win',
        blurb: 'Explain it to someone who keeps asking why.',
        // The graph is what the AI student is ignorant about.
        locked: !graph,
      },
      { kind: 'sealed', label: 'Sealed', blurb: 'Coming soon', locked: true },
    ],
    [graph, gauntlet],
  )

  // Layout is pure, but it can still reject content the schema let through, so
  // a throw here is a state and not a crash.
  const world = useMemo<{ map: WorldMap | null; error: string | null }>(() => {
    if (!game) return { map: null, error: null }
    try {
      return {
        map: buildHub({
          // Stable per world: the decor scatter must not move between renders.
          seed: worldId ?? game.game_id,
          title: game.title,
          background: HUB_BACKGROUND,
          portals: portalSpecs,
        }),
        error: null,
      }
    } catch (error) {
      return { map: null, error: error instanceof Error ? error.message : 'The world could not be built.' }
    }
  }, [game, worldId, portalSpecs])

  const map = world.map

  // Resolved from the map, so a kind left over from another world simply reads
  // as "nothing open" and the player keeps walking.
  const openNode = useMemo<PortalNode | null>(() => {
    if (!map || !openPortal) return null
    return map.portals.find((portal) => portal.kind === openPortal) ?? null
  }, [map, openPortal])

  const player = usePlayer(map, { enabled: openPortal === null })
  const panelRef = useRef<HTMLDivElement | null>(null)

  /**
   * A hotspot, not a single tile: at 5.4 tiles/s a one-tile target is genuinely
   * hard to land on. Keyed on `player.tile` — React state that only changes when
   * the player crosses a tile boundary — rather than the float body, which would
   * need a per-frame subscription to buy a few pixels of precision.
   */
  const portalHere = useMemo<PortalNode | null>(
    () => map?.portals.find((portal) => inRect(portal.hotspot, player.tile)) ?? null,
    [map, player.tile],
  )

  /**
   * The two lists `gating` reads out of the content, each memoised on the
   * payload it comes from. Inline `.map(...)` calls would hand `clearedPortals`
   * a new array on every render, and the `Set` it feeds ends up on
   * `WorldCanvas`, whose effects key on identity — the same trap `portalSpecs`
   * documents above.
   */
  const conceptIds = useMemo(() => graph?.concepts.map((concept) => concept.id) ?? [], [graph])
  // Prediction scenes only, matching what `QuizPanel` actually asks: a dialogue
  // scene has no answer to grade and would raise the bar it can never clear.
  const quizSceneIds = useMemo(
    () =>
      gauntlet
        ? gauntlet.chapters.flatMap((chapter) =>
            chapter.scenes.filter((scene) => scene.type === 'prediction').map((scene) => scene.id),
          )
        : [],
    [gauntlet],
  )

  /**
   * Which portals count as finished. Browser-side by construction — read the
   * note at the top of `gating.ts` — so it drives pips, the canvas and copy,
   * and nothing that claims to be a result: XP stays the server's word.
   */
  const clearState = useMemo(
    () =>
      clearedPortals({
        conceptIds,
        readConceptIds: read,
        quizSceneIds,
        correctSceneIds: correct,
        explainedConceptIds: explained,
      }),
    [conceptIds, read, quizSceneIds, correct, explained],
  )

  const cleared = useMemo<ReadonlySet<PortalKind>>(() => {
    const kinds = new Set<PortalKind>()
    if (clearState.storybook) kinds.add('storybook')
    if (clearState.quiz) kinds.add('quiz')
    if (clearState.explain) kinds.add('explain')
    return kinds
  }, [clearState])

  const allCleared = worldCleared(clearState)

  /**
   * The trail reads the gauntlet, not the quest. With the quest no longer
   * walkable nothing will ever mark a quest scene done, so a trail counting
   * quest scenes would read 0/N for the whole demo.
   */
  const trail = useMemo(() => {
    const source = gauntlet ?? game
    return source ? conceptTrail(graph, source, completed, correct) : []
  }, [graph, gauntlet, game, completed, correct])

  const [committing, setCommitting] = useState(false)

  /**
   * The one place an answer is committed, for every gate that asks a question.
   *
   * It posts the attempt, merges the server's verdict with the graph through
   * `diagnose`, and records what actually happened to the answer — `saved`,
   * `failed` or `offline` — because `RewardNote` may only claim XP when the
   * server really recorded it.
   *
   * `archetype: 'gauntlet'` is load-bearing. The quiz's scene ids come from
   * `games.gauntlet`, and the server resolves an attempt by
   * `(world, archetype, scene_id)`: sending `'quest'` would point it at a game
   * these ids do not exist in, and every answer would grade against nothing.
   * The `getProgress` filter above matches this on purpose.
   *
   * A failed post still teaches. The learner gets the full diagnosis graded
   * offline from `Option.correct`, and is told plainly that it was not
   * recorded — losing the network should cost XP, not the lesson.
   */
  const commit = useCallback(
    (scene: PredictionScene, option: Option) => {
      setCommitting(true)
      const posted: Promise<AttemptOut | null> = worldId
        ? api.postAttempt(worldId, { archetype: 'gauntlet', scene_id: scene.id, option_id: option.id })
        : // The bundled fixture world has no server behind it.
          Promise.resolve(null)

      posted
        .then((verdict) => ({ verdict, persistence: (verdict ? 'saved' : 'offline') as Persistence }))
        .catch(() => ({ verdict: null as AttemptOut | null, persistence: 'failed' as Persistence }))
        .then(({ verdict, persistence }) => {
          const diagnosis = diagnose(graph, scene, option, verdict)
          updateSession((current) => ({
            completed: new Set([...current.completed, scene.id]),
            // Additive, mirroring the server's `best_correct`: a scene answered
            // right once stays right, however it is answered afterwards.
            correct: diagnosis.correct ? new Set([...current.correct, scene.id]) : current.correct,
            outcomes: {
              ...current.outcomes,
              [scene.id]: {
                optionId: option.id,
                diagnosis,
                xpAwarded: verdict ? verdict.xp_awarded : null,
                persistence,
              },
            },
            // The server is authority on XP; nothing is added client-side.
            xp: verdict ? verdict.world_xp : current.xp,
          }))
          setCommitting(false)
        })
    },
    [worldId, graph, updateSession],
  )

  /**
   * Let the learner answer these scenes again.
   *
   * Only the local record is dropped. `completed` stays — walking a scene is a
   * fact that a retry does not undo — and `correct` stays because correctness
   * is sticky on both sides of the wire, so a retry can only ever add to it.
   * The server keeps every attempt either way; re-answering posts a fresh one,
   * which is why the second attempt is honestly worth no new XP.
   */
  const retryScenes = useCallback(
    (sceneIds: readonly string[]) => {
      if (sceneIds.length === 0) return
      updateSession((current) => {
        const outcomes = { ...current.outcomes }
        const restored = { ...current.restored }
        for (const id of sceneIds) {
          delete outcomes[id]
          delete restored[id]
        }
        return { outcomes, restored }
      })
    },
    [updateSession],
  )

  /**
   * The AI student finally understood something.
   *
   * Both numbers come from the server: the XP was awarded when the last turn
   * was graded, and the concept is now in `explained_concept_ids`, so nothing
   * here is invented. Recording it locally only saves a round trip — a reload
   * rebuilds the same set from `GET /progress`.
   */
  const onExplained = useCallback(
    (result: ExplainOut) => {
      updateSession((current) => ({
        xp: result.world_xp,
        explained: new Set([...current.explained, result.concept.id]),
      }))
    },
    [updateSession],
  )

  /**
   * A storybook page was opened.
   *
   * `StorybookPanel` fires this for whichever concept is on screen, including
   * the one it opens on, so it arrives again for a page already read: the
   * updater returns `null` in that case, keeping the set's identity stable —
   * `cleared` is derived from it and the canvas keys its effects on identity.
   */
  const markRead = useCallback(
    (conceptId: string) => {
      updateSession((current) => (current.read.has(conceptId) ? null : { read: new Set([...current.read, conceptId]) }))
    },
    [updateSession],
  )

  // Written from an effect rather than from the updater above, which must stay
  // pure. The first run rewrites what `loadRead` just read, which is harmless.
  useEffect(() => {
    saveRead(worldId, read)
  }, [worldId, read])

  const close = useCallback(() => {
    setOpenPortal(null)
  }, [])

  /**
   * Leaving says nothing about what was achieved, on purpose: the browser only
   * knows which portals were walked, and XP is the server's word. So this is a
   * door, not a summary.
   */
  const leave = useCallback(() => {
    window.location.href = LEAVE_HREF
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Escape steps back one level: out of an open portal if there is one,
      // otherwise out of the world entirely. Closing keeps its old behaviour,
      // so a learner mid-question never loses the map under them.
      if (event.key === 'Escape') {
        if (openPortal !== null) {
          close()
          return
        }
        event.preventDefault()
        leave()
        return
      }
      if (openPortal !== null) return
      if (event.key !== 'e' && event.key !== 'E' && event.key !== 'Enter') return
      // Enter belongs to whatever control has focus, if any. `target` is not
      // always an Element (it can be the document, or the window for a
      // synthesised event), so the instance check is load-bearing.
      const target = event.target
      if (target instanceof Element && target.closest('button, a, input, textarea, select')) return
      if (!portalHere) return
      // A locked gate does not open. It also does not advertise a key, so this
      // is never a surprise — see the walk-up prompt below.
      if (portalHere.locked) return
      event.preventDefault()
      setOpenPortal(portalHere.kind)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [portalHere, openPortal, close, leave])

  // Move focus into the overlay so the keyboard follows the eye.
  useEffect(() => {
    if (openPortal) panelRef.current?.focus()
  }, [openPortal])

  if (!map) {
    if (world.error) {
      return (
        <Notice tone="error" eyebrow="World unavailable" title="This quest could not be laid out.">
          <p className="mt-3 text-ink-muted">{world.error}</p>
          <button className="button-primary mt-6" onClick={() => window.location.reload()}>
            Try again
          </button>
        </Notice>
      )
    }

    if (load.status === 'picker') return <WorldPicker />

    if (load.status === 'loading') {
      return (
        <main className="grid min-h-screen place-items-center bg-app-grid p-6">
          <div className="text-center" role="status" aria-live="polite">
            <span className="mx-auto grid h-12 w-12 animate-pulse place-items-center rounded-xl bg-primary font-black text-background">
              CQ
            </span>
            <p className="mt-4 text-sm font-semibold text-ink-muted">Loading your world…</p>
          </div>
        </main>
      )
    }

    if (load.status === 'empty') {
      return (
        <Notice tone="quiet" eyebrow="Nothing to walk yet" title={`${load.title} has no quest yet.`}>
          <p className="mt-3 text-ink-muted">
            This world finished generating without a quest, so there is no map to lay out. Regenerate it from the
            server screen, or open a different world.
          </p>
          <a className="button-secondary mt-6" href="/">
            Back to your servers
          </a>
        </Notice>
      )
    }

    if (load.status === 'error') {
      return (
        <Notice tone="error" eyebrow="World unavailable" title="This world could not be loaded.">
          <p className="mt-3 text-ink-muted">{load.message}</p>
          <div className="mt-6 flex flex-wrap gap-3">
            {load.needsSignIn ? (
              <a className="button-primary" href="/">
                Sign in
              </a>
            ) : (
              <button className="button-primary" onClick={() => window.location.reload()}>
                Try again
              </button>
            )}
            <a className="button-secondary" href={FIXTURE_HREF}>
              Walk the demo world
            </a>
          </div>
        </Notice>
      )
    }

    return null
  }

  // The sealed door is scenery, not progress: it is never counted and never
  // clearable, so the readout stays honest at three.
  const gates = map.portals.filter((portal) => portal.kind !== 'sealed')
  const clearedCount = gates.filter((portal) => cleared.has(portal.kind)).length

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-background">
      <WorldCanvas map={map} player={player.body} cleared={cleared} activePortal={portalHere?.kind ?? null} />

      {/* HUD */}
      <div className="pointer-events-none absolute inset-0 flex items-start justify-between gap-4 p-4 sm:p-6">
        <div className="pointer-events-auto rounded-2xl border border-white/10 bg-background/75 px-4 py-3 shadow-2xl shadow-black/40 backdrop-blur">
          <div className="flex flex-wrap items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary font-black text-background" aria-hidden="true">
              CQ
            </span>
            <div>
              <p className="text-sm font-black leading-tight tracking-tight text-ink">{map.title}</p>
              <p className="text-xs text-ink-muted">{portalHere ? portalHere.label : 'The Hub'}</p>
            </div>
            {xp !== null && (
              <span
                className="ml-2 rounded-full border border-primary/35 bg-primary/10 px-3 py-1 text-xs font-black text-primary-soft"
                aria-label={`${xp} experience points in this world`}
                aria-live="polite"
              >
                {xp} XP
              </span>
            )}
            {/* The way out, and the only one there was: a first-time viewer has
                to see it without hunting, so it sits in the card everyone is
                already reading and carries its own keyboard hint. */}
            <a
              className="ml-auto flex items-center gap-2 rounded-lg border border-white/20 bg-white/5 px-3 py-2 text-xs font-black text-ink-muted transition hover:border-white/40 hover:bg-white/10 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              href={LEAVE_HREF}
            >
              <span aria-hidden="true">←</span>
              Leave world
              <kbd className="hidden rounded border border-white/15 bg-background/70 px-1.5 py-0.5 font-mono text-[10px] font-bold text-ink-muted sm:inline">
                Esc
              </kbd>
            </a>
          </div>
          <div className="mt-3 flex items-center gap-3">
            {/* One pip per gate, in its own colour, so the three modes are
                distinguishable at a glance and not just a count. */}
            <div className="flex items-center gap-1.5" aria-hidden="true">
              {gates.map((portal) => {
                const art = portalArt(portal.kind)
                const lit = cleared.has(portal.kind)
                return (
                  <span
                    key={portal.kind}
                    className="h-2.5 w-2.5 rounded-full border transition-colors duration-300"
                    style={{
                      backgroundColor: lit ? art.core : 'transparent',
                      borderColor: lit ? art.rim : art.glow,
                      boxShadow: lit ? `0 0 8px ${art.glow}` : undefined,
                    }}
                  />
                )
              })}
            </div>
            <div className="h-1.5 w-28 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-secondary transition-[width] duration-300"
                style={{ width: `${gates.length === 0 ? 0 : (clearedCount / gates.length) * 100}%` }}
              />
            </div>
            <p className="text-xs font-bold text-secondary" aria-live="polite">
              {clearedCount} / {gates.length} portals cleared
            </p>
          </div>
          {/* A quiet full house, and deliberately nothing more: it blocks
              nothing, unlocks nothing and awards nothing. It says the learner
              has been through all three portals, which is exactly what the
              browser can know — see the note at the top of `gating.ts`. */}
          {allCleared && (
            <p className="mt-2 text-xs font-bold text-primary-soft" aria-live="polite">
              You have been through all three portals — read, answered and explained. Nice run.
            </p>
          )}
        </div>

        {/* The trail rides beside the canvas, not inside the overlay: the
            continuity between concepts has to be visible while walking. */}
        {/* Full height, with the trail pushed to the bottom: the top-right
            corner is where the third gate stands, and a panel parked there hid
            it completely. */}
        <div className="flex w-72 max-w-[45vw] flex-col items-end gap-3 self-stretch">
          <div className="pointer-events-auto hidden rounded-2xl border border-white/10 bg-background/70 px-4 py-3 text-right text-xs font-semibold text-ink-muted backdrop-blur sm:block">
            <p>
              <kbd className="font-mono text-ink">WASD</kbd> / <kbd className="font-mono text-ink">arrows</kbd> to walk
            </p>
            <p className="mt-1">
              <kbd className="font-mono text-ink">E</kbd> to enter a portal ·{' '}
              <kbd className="font-mono text-ink">Esc</kbd> to close it
            </p>
            <p className="mt-1">
              <kbd className="font-mono text-ink">Esc</kbd> out on the map to leave the world
            </p>
          </div>
          {trail.length > 0 && (
            <div className="pointer-events-auto mt-auto hidden w-full md:block">
              {/* No active concept: which one is on screen is known inside an
                  open portal, and the trail is what the walker reads between
                  them. Hoisting that state here would buy a highlight and cost
                  a re-render of the world on every page turn. */}
              <WorldConceptTrail trail={trail} />
            </div>
          )}
        </div>
      </div>

      {/* Walk-up prompt */}
      {portalHere && !openPortal && (
        <div className="pointer-events-none absolute inset-x-0 bottom-8 flex justify-center px-4">
          <div
            className="stage-enter pointer-events-auto flex items-center gap-3 rounded-full border bg-background/85 px-5 py-3 shadow-2xl shadow-black/40 backdrop-blur"
            style={{ borderColor: portalArt(portalHere.kind).glow }}
          >
            {/* A locked gate advertises no key: the prompt explains what is
                behind the door without promising it opens. */}
            {!portalHere.locked && (
              <kbd className="rounded-lg border border-primary/50 bg-primary/15 px-2 py-1 font-mono text-sm font-black text-primary-soft">
                E
              </kbd>
            )}
            <span className="text-sm font-bold text-ink">
              {portalHere.locked
                ? portalHere.label
                : `${cleared.has(portalHere.kind) ? 'Re-enter' : 'Enter'} ${portalHere.label}`}
            </span>
            <span className="text-xs font-semibold text-ink-muted">{portalHere.blurb}</span>
          </div>
        </div>
      )}

      {/* Gate overlay. One shell for all four gates: the body switches, the
          dialog, backdrop and focus behaviour never do. */}
      {openNode && (
        <div className="absolute inset-0 z-10 grid place-items-center bg-background/80 p-4 backdrop-blur-sm sm:p-8">
          <button
            type="button"
            className="absolute inset-0 h-full w-full cursor-default"
            aria-label="Close portal"
            onClick={close}
          />
          <section
            ref={panelRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-labelledby="gate-title"
            // One shell, one width knob: the quiz carries a question strip and a
            // score card and needs the extra column, every other gate does not.
            className={`stage-enter quest-panel relative max-h-full w-full ${
              openNode.kind === 'quiz' ? 'max-w-3xl' : 'max-w-2xl'
            } overflow-y-auto rounded-2xl border border-white/10 bg-surface/95 p-6 shadow-2xl shadow-black/50 outline-none sm:p-8`}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="eyebrow" style={{ color: portalArt(openNode.kind).rim }}>
                  Portal
                </p>
                <h2 id="gate-title" className="mt-2 text-2xl font-black tracking-tight text-ink">
                  {openNode.label}
                </h2>
                <p className="mt-2 text-sm leading-6 text-ink-muted">{openNode.blurb}</p>
              </div>
              <button type="button" className="button-secondary" onClick={close}>
                Close
              </button>
            </div>

            <div className="mt-6">
              {openNode.kind === 'quiz' && gauntlet ? (
                <QuizPanel
                  gauntlet={gauntlet}
                  graph={graph}
                  outcomes={session.outcomes}
                  restored={session.restored}
                  committing={committing}
                  onCommit={commit}
                  onRetry={retryScenes}
                  onClose={close}
                />
              ) : openNode.kind === 'explain' && graph ? (
                <ExplainPanel
                  worldId={worldId ?? null}
                  graph={graph}
                  explained={explained}
                  onCleared={onExplained}
                  onClose={close}
                />
              ) : openNode.kind === 'storybook' ? (
                <StorybookPanel graph={graph} readIds={read} onRead={markRead} onClose={close} />
              ) : (
                // Only `sealed` reaches here, and it is locked, so nothing can
                // open it: no keyboard path, no click path. The branch exists so
                // the switch is total.
                null
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  )
}

/**
 * The scene loop: predict → commit → diagnosis → evidence.
 *
 * Inert on a hub map, which emits `nodes: []`. `QuizPanel` runs the same
 * sequence over the gauntlet but drives the `SceneStages` directly, because it
 * needs its own continue labels ("Next question", not "Back to the world").
 * This stays on disk because it is the only renderer for dialogue and
 * simulation scenes, which the quiz has no place for; delete it with the rest
 * of the node-walking path after the demo.
 */
export function ScenePanel({
  scene,
  outcome,
  stage,
  selectedId,
  committing,
  onSelect,
  onCommit,
  onStage,
  onFinish,
}: {
  scene: Scene
  outcome: SceneOutcome | null
  stage: Stage
  selectedId: string | null
  committing: boolean
  onSelect: (optionId: string) => void
  onCommit: (scene: PredictionScene, option: Option) => void
  onStage: (stage: Stage) => void
  onFinish: () => void
}) {
  if (scene.type === 'dialogue') {
    return (
      <div>
        <div className="space-y-4">
          {scene.lines.map((line, i) => (
            <p key={i} className="border-l-2 border-secondary/60 pl-4 text-lg leading-8 text-ink">
              {line}
            </p>
          ))}
        </div>
        <button className="button-primary mt-7" onClick={onFinish}>
          Continue
        </button>
      </div>
    )
  }

  if (scene.type === 'simulation') {
    return (
      <div>
        <p className="eyebrow text-secondary">Simulation · {humanise(scene.widget)}</p>
        <h3 className="mt-3 text-xl font-black leading-tight text-ink">{scene.instruction}</h3>
        <div className="mt-6 grid h-40 place-items-center rounded-xl border border-dashed border-secondary/30 bg-background/40 text-center">
          <p className="px-6 text-sm font-semibold text-ink-muted">
            The <span className="font-mono text-secondary">{scene.widget}</span> widget runs here.
          </p>
        </div>
        {scene.success_condition && (
          <p className="mt-4 text-sm leading-6 text-ink-muted">Goal: {scene.success_condition}</p>
        )}
        <button className="button-primary mt-6" onClick={onFinish}>
          Mark as done
        </button>
      </div>
    )
  }

  const evidence = outcome?.diagnosis.evidence ?? null
  const hasEvidence = Boolean(evidence && filled(evidence.quote))

  if (outcome && stage === 'diagnosis') {
    return (
      <DiagnosisStage
        diagnosis={outcome.diagnosis}
        onContinue={hasEvidence ? () => onStage('evidence') : onFinish}
        continueLabel={hasEvidence ? 'See what your notes say' : 'Back to the world'}
      />
    )
  }

  if (outcome && stage === 'evidence' && evidence && hasEvidence) {
    return (
      <EvidenceStage
        quote={evidence.quote}
        segment={evidence.segment_id}
        title={outcome.diagnosis.sourceTitle}
        onContinue={onFinish}
      />
    )
  }

  return (
    <PredictionStage
      scene={scene}
      outcome={outcome}
      selectedId={selectedId}
      committing={committing}
      onSelect={onSelect}
      onCommit={onCommit}
      onContinue={() => onStage('diagnosis')}
    />
  )
}
