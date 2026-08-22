/**
 * The world screen: a generated course, walked.
 *
 * The canvas owns the pixels and `usePlayer` owns the walking; this file owns
 * the meaning — which scene the player is standing on, whether it is open, what
 * has been finished, and what the learner is told once they commit.
 *
 * The teaching loop is the point of the product, so the scene overlay is staged
 * rather than one-shot: predict -> commit -> diagnosis -> evidence. Committing
 * is a deliberate act (a button, never a click-through) because a prediction
 * the learner never owned teaches nothing, and the diagnosis names the specific
 * wrong belief they hold instead of reciting the same paragraph to everybody.
 * `./pedagogy` merges the server's verdict with the course graph to produce it;
 * this file only renders and sequences.
 *
 * Three ways in. With a `worldId` it loads the learner's real world through
 * `api.getWorld` and walks `games.quest`. Without one it shows `WorldPicker`,
 * because otherwise a generated world is only reachable by typing its id into
 * the address bar. `/world?demo=1` walks the bundled fixture, the offline
 * safety net for the pitch. The fixture is never used as a fallback for a real
 * world that failed to load: showing somebody else's course while they asked
 * for their own is worse than an honest error.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { api, ApiError } from '../api/client'
import type { CourseGraph, Game, Option, PredictionScene, Scene, SceneProgress } from '../api/types'
import { fixtureGraph, fixtureQuest } from '../fixtures'
import { conceptTrail, diagnose } from './pedagogy'
import type { Diagnosis } from './pedagogy'
import type { SceneNode, WorldMap } from './types'
import { usePlayer } from './usePlayer'
import { WorldCanvas } from './WorldCanvas'
import { WorldConceptTrail } from './WorldConceptTrail'
import { FIXTURE_HREF, WorldPicker } from './WorldPicker'
import { buildWorld } from './worldgen'

/** `mentor_owl` -> `Mentor owl`. The enums are the label; there is no second table to drift. */
const humanise = (value: string) => {
  const words = value.replace(/_/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** Whitespace-only strings are missing data, not content: never render a panel for one. */
const filled = (value: string | null | undefined): value is string =>
  typeof value === 'string' && value.trim() !== ''

/**
 * `games.quest` is nullable: the backend persists a world whose generation only
 * partly succeeded. That is a state of its own, not a network failure, and it
 * gets its own screen. `graph` is nullable too, and is carried rather than
 * dropped: it is where misconceptions and source quotes live, so without it
 * nothing downstream can diagnose anything.
 */
type Load =
  | { status: 'loading' }
  | { status: 'ready'; game: Game; graph: CourseGraph | null }
  | { status: 'picker' }
  | { status: 'empty'; title: string }
  | { status: 'error'; message: string; needsSignIn: boolean }

/** Where the committed answer ended up. Only `saved` may claim XP was awarded. */
type Persistence = 'saved' | 'failed' | 'offline'

/** What the learner committed to on one scene, and what they were told back. */
interface SceneOutcome {
  optionId: string
  diagnosis: Diagnosis
  /** What the server awarded for this commit. Null when nothing was recorded. */
  xpAwarded: number | null
  persistence: Persistence
}

/** The overlay is staged so the learner commits before being taught. */
type Stage = 'prediction' | 'diagnosis' | 'evidence'

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
  outcomes: Record<string, SceneOutcome>
  /** Server-side history, so a reload does not erase what the learner already did. */
  restored: Record<string, SceneProgress>
  /** World XP as the server knows it. Null means there is nothing honest to show. */
  xp: number | null
}

const freshSession = (key: string | undefined): Session => ({
  key,
  completed: new Set<string>(),
  correct: new Set<string>(),
  outcomes: {},
  restored: {},
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
          ? // The fixture ships its own graph, so the offline demo diagnoses in full.
            { status: 'ready', game: fixtureQuest, graph: fixtureGraph }
          : { status: 'picker' }

  const [stored, setStored] = useState<Session>(() => freshSession(worldId))
  const session = stored.key === worldId ? stored : freshSession(worldId)
  const { completed, correct, outcomes, restored, xp } = session
  const [openSceneId, setOpenSceneId] = useState<string | null>(null)
  const [stage, setStage] = useState<Stage>('prediction')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [committing, setCommitting] = useState(false)

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
        updateSession(() => ({ xp: detail.my_progress.xp }))
        setFetched({ id: worldId, value: { status: 'ready', game: quest, graph: detail.graph } })
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
        const quest = progress.scenes.filter((scene) => scene.archetype === 'quest')
        // "Done" means walked, not necessarily right: the loop finishes with the
        // diagnosis, and a scene the learner got wrong is still behind them.
        // Mastery is the other set, and it is seeded from `best_correct` rather
        // than from having attempted: the server already remembers the best
        // attempt, so a scene fixed on the second try comes back right.
        updateSession((current) => ({
          completed: new Set(quest.map((scene) => scene.scene_id)),
          // Unioned, not replaced: this reply can land after a commit the
          // learner already made, and correctness never goes backwards.
          correct: new Set([
            ...current.correct,
            ...quest.filter((scene) => scene.best_correct).map((scene) => scene.scene_id),
          ]),
          restored: Object.fromEntries(quest.map((scene) => [scene.scene_id, scene])),
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
  const graph = load.status === 'ready' ? load.graph : null

  // Layout is pure, but it can still reject content the schema let through, so
  // a throw here is a state and not a crash.
  const world = useMemo<{ map: WorldMap | null; error: string | null }>(() => {
    if (!game) return { map: null, error: null }
    try {
      return { map: buildWorld(game), error: null }
    } catch (error) {
      return { map: null, error: error instanceof Error ? error.message : 'The world could not be built.' }
    }
  }, [game])

  const map = world.map

  // Resolved from the map, so an id left over from another world simply reads
  // as "nothing open" and the player keeps walking.
  const openNode = useMemo<SceneNode | null>(() => {
    if (!map || !openSceneId) return null
    return map.nodes.find((node) => node.sceneId === openSceneId) ?? null
  }, [map, openSceneId])

  const player = usePlayer(map, { enabled: openNode === null })
  const panelRef = useRef<HTMLDivElement | null>(null)

  const nodeHere = useMemo<SceneNode | null>(() => {
    if (!map) return null
    return map.nodes.find((node) => node.at.x === player.tile.x && node.at.y === player.tile.y) ?? null
  }, [map, player.tile])

  const room = useMemo(() => {
    if (!map) return null
    return (
      map.rooms.find(
        (candidate) =>
          player.tile.x >= candidate.x - 1 &&
          player.tile.x <= candidate.x + candidate.w &&
          player.tile.y >= candidate.y - 1 &&
          player.tile.y <= candidate.y + candidate.h,
      ) ?? null
    )
  }, [map, player.tile])

  const trail = useMemo(
    () => (game ? conceptTrail(graph, game, completed, correct) : []),
    [graph, game, completed, correct],
  )

  // The concept the player is working on: the open scene wins over the tile
  // they happen to be standing on.
  const activeConceptId = useMemo(() => {
    const scene = openNode?.scene ?? nodeHere?.scene
    if (!scene) return null
    return 'concept_id' in scene ? scene.concept_id : null
  }, [openNode, nodeHere])

  /**
   * What the learner already committed on the open scene. Local commits win;
   * otherwise a prior answer restored from the server is re-diagnosed from the
   * graph, which is why the panel survives a reload with its meaning intact.
   */
  const outcome = useMemo<SceneOutcome | null>(() => {
    if (!openNode) return null
    const local = outcomes[openNode.sceneId]
    if (local) return local
    const prior = restored[openNode.sceneId]
    if (!prior?.chosen_option_id || openNode.scene.type !== 'prediction') return null
    const option = openNode.scene.options.find((candidate) => candidate.id === prior.chosen_option_id)
    if (!option) return null
    return {
      optionId: option.id,
      diagnosis: diagnose(graph, openNode.scene, option, null),
      xpAwarded: null,
      persistence: 'saved',
    }
  }, [openNode, outcomes, restored, graph])

  const markComplete = useCallback(
    (sceneId: string) => {
      updateSession((current) => {
        if (current.completed.has(sceneId)) return null
        const next = new Set(current.completed)
        next.add(sceneId)
        return { completed: next }
      })
    },
    [updateSession],
  )

  const openScene = useCallback(
    (sceneId: string) => {
      setOpenSceneId(sceneId)
      setSelectedId(null)
      setCommitting(false)
      // A scene already answered reopens on its teaching, not on a locked quiz.
      setStage(outcomes[sceneId] || restored[sceneId]?.chosen_option_id ? 'diagnosis' : 'prediction')
    },
    [outcomes, restored],
  )

  const close = useCallback(() => {
    setOpenSceneId(null)
    setSelectedId(null)
    setCommitting(false)
  }, [])

  /**
   * Commit: the server grades, the client never does. Offline (the fixture has
   * no world id) there is nobody to ask, so `diagnose` falls back to the
   * option's own flag. A failed POST still teaches — a network blip must not
   * strand the learner mid-scene — it just does not claim any XP.
   */
  const commit = useCallback(
    async (scene: PredictionScene, option: Option) => {
      setCommitting(true)
      let verdict = null
      let persistence: Persistence = 'offline'
      if (worldId) {
        try {
          verdict = await api.postAttempt(worldId, {
            archetype: 'quest',
            scene_id: scene.id,
            option_id: option.id,
          })
          persistence = 'saved'
          const world_xp = verdict.world_xp
          updateSession(() => ({ xp: world_xp }))
        } catch {
          persistence = 'failed'
        }
      }
      // One verdict for both the panel and the trail. Online this is the
      // server's `correct`; offline (and if the POST never landed) it is the
      // option's own flag, which is exactly what the learner was just shown —
      // the trail must never contradict the diagnosis on screen.
      const diagnosis = diagnose(graph, scene, option, verdict)
      updateSession((current) => ({
        outcomes: {
          ...current.outcomes,
          [scene.id]: {
            optionId: option.id,
            diagnosis,
            xpAwarded: verdict ? verdict.xp_awarded : null,
            persistence,
          },
        },
        // Additive only: a right answer stays right, matching `best_correct`.
        correct: diagnosis.correct ? new Set(current.correct).add(scene.id) : current.correct,
      }))
      markComplete(scene.id)
      setCommitting(false)
    },
    [worldId, graph, markComplete, updateSession],
  )

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        close()
        return
      }
      if (openNode !== null) return
      if (event.key !== 'e' && event.key !== 'E' && event.key !== 'Enter') return
      // Enter belongs to whatever control has focus, if any. `target` is not
      // always an Element (it can be the document, or the window for a
      // synthesised event), so the instance check is load-bearing.
      const target = event.target
      if (target instanceof Element && target.closest('button, a, input, textarea, select')) return
      if (!nodeHere) return
      event.preventDefault()
      openScene(nodeHere.sceneId)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [nodeHere, openNode, openScene, close])

  // Move focus into the overlay so the keyboard follows the eye — on open, and
  // again on each stage, whose own controls have just been replaced.
  useEffect(() => {
    if (openNode) panelRef.current?.focus()
  }, [openNode, stage])

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

  const total = map.nodes.length
  const done = completed.size

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-background">
      <WorldCanvas
        map={map}
        player={player.body}
        completed={completed}
        activeSceneId={nodeHere?.sceneId ?? null}
      />

      {/* HUD */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-4 p-4 sm:p-6">
        <div className="pointer-events-auto rounded-2xl border border-white/10 bg-background/75 px-4 py-3 shadow-2xl shadow-black/40 backdrop-blur">
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary font-black text-background" aria-hidden="true">
              CQ
            </span>
            <div>
              <p className="text-sm font-black leading-tight tracking-tight text-ink">{map.title}</p>
              <p className="text-xs text-ink-muted">{room ? room.title : 'Between chapters'}</p>
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
          </div>
          <div className="mt-3 flex items-center gap-3">
            <div className="h-1.5 w-36 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-secondary transition-[width] duration-300"
                style={{ width: `${total === 0 ? 0 : (done / total) * 100}%` }}
              />
            </div>
            <p className="text-xs font-bold text-secondary" aria-live="polite">
              {done} / {total} scenes
            </p>
          </div>
        </div>

        {/* The trail rides beside the canvas, not inside the overlay: the
            continuity between concepts has to be visible while walking. */}
        <div className="flex w-72 max-w-[45vw] flex-col items-end gap-3">
          <div className="pointer-events-auto hidden rounded-2xl border border-white/10 bg-background/70 px-4 py-3 text-right text-xs font-semibold text-ink-muted backdrop-blur sm:block">
            <p>
              <kbd className="font-mono text-ink">WASD</kbd> / <kbd className="font-mono text-ink">arrows</kbd> to walk
            </p>
            <p className="mt-1">
              <kbd className="font-mono text-ink">E</kbd> to interact ·{' '}
              <kbd className="font-mono text-ink">Esc</kbd> to close
            </p>
          </div>
          {trail.length > 0 && (
            <div className="pointer-events-auto hidden w-full md:block">
              <WorldConceptTrail trail={trail} activeConceptId={activeConceptId} />
            </div>
          )}
        </div>
      </div>

      {/* Interaction prompt */}
      {nodeHere && !openNode && (
        <div className="pointer-events-none absolute inset-x-0 bottom-8 flex justify-center px-4">
          <div className="stage-enter pointer-events-auto flex items-center gap-3 rounded-full border border-primary/40 bg-background/85 px-5 py-3 shadow-2xl shadow-black/40 backdrop-blur">
            <kbd className="rounded-lg border border-primary/50 bg-primary/15 px-2 py-1 font-mono text-sm font-black text-primary-soft">
              E
            </kbd>
            <span className="text-sm font-bold text-ink">
              {completed.has(nodeHere.sceneId) ? 'Revisit' : 'Talk to'} {humanise(nodeHere.actor)}
            </span>
            <span className="text-xs font-semibold text-ink-muted">scene {nodeHere.order + 1}</span>
          </div>
        </div>
      )}

      {/* Scene overlay */}
      {openNode && (
        <div className="absolute inset-0 z-10 grid place-items-center bg-background/80 p-4 backdrop-blur-sm sm:p-8">
          <button
            type="button"
            className="absolute inset-0 h-full w-full cursor-default"
            aria-label="Close scene"
            onClick={close}
          />
          <section
            ref={panelRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-labelledby="scene-title"
            className="stage-enter quest-panel relative max-h-full w-full max-w-2xl overflow-y-auto rounded-2xl border border-white/10 bg-surface/95 p-6 shadow-2xl shadow-black/50 outline-none sm:p-8"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="eyebrow">
                  Scene {openNode.order + 1} of {total} · {humanise(openNode.scene.type)}
                </p>
                <h2 id="scene-title" className="mt-2 text-2xl font-black tracking-tight text-ink">
                  {humanise(openNode.actor)}
                </h2>
              </div>
              <button type="button" className="button-secondary" onClick={close}>
                Close
              </button>
            </div>

            <div className="mt-6">
              <ScenePanel
                scene={openNode.scene}
                outcome={outcome}
                stage={stage}
                selectedId={selectedId}
                committing={committing}
                onSelect={setSelectedId}
                onCommit={commit}
                onStage={setStage}
                onFinish={() => {
                  markComplete(openNode.sceneId)
                  close()
                }}
              />
            </div>
          </section>
        </div>
      )}
    </div>
  )
}

function ScenePanel({
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
        continueLabel={hasEvidence ? 'Open verified evidence' : 'Back to the world'}
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

/**
 * The gate. Options lock the moment the learner commits, and committing is a
 * separate button because owning the guess is what makes the correction land.
 */
function PredictionStage({
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
function DiagnosisStage({
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

function Insight({ label, text, tone = 'neutral' }: { label: string; text: string; tone?: 'neutral' | 'amber' | 'teal' }) {
  const color = tone === 'amber' ? 'text-primary-soft' : tone === 'teal' ? 'text-secondary' : 'text-ink-muted'
  return (
    <div className="rounded-xl border border-white/10 bg-surface-high/65 p-5">
      <p className={`text-xs font-extrabold uppercase tracking-[0.17em] ${color}`}>{label}</p>
      <p className="mt-2 leading-7 text-ink">{text}</p>
    </div>
  )
}

/** The receipt: the exact sentence from the learner's own upload that settles it. */
function EvidenceStage({
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
function RewardNote({ outcome }: { outcome: SceneOutcome }) {
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

function OptionButton({
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

function Notice({
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
