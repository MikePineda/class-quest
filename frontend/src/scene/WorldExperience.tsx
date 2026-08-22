/**
 * The world screen: a generated course, walked.
 *
 * The canvas owns the pixels and `usePlayer` owns the walking; this file owns
 * the meaning — which scene the player is standing on, whether it is open, and
 * what has been finished. The overlay is deliberately plain: the scene panels
 * are somebody else's surface to polish, so this renders each scene type
 * honestly and stops.
 *
 * Three ways in. With a `worldId` it loads the learner's real world through
 * `api.getWorld` and walks `games.quest`. Without one it shows `WorldPicker`,
 * because otherwise a generated world is only reachable by typing its id into
 * the address bar. `/world?demo=1` walks the bundled fixture, the offline
 * safety net for the pitch. The fixture is never used as a fallback for a real
 * world that failed to load: showing somebody else's course while they asked
 * for their own is worse than an honest error.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { api, ApiError } from '../api/client'
import type { Game, Option, Scene } from '../api/types'
import { fixtureQuest } from '../fixtures'
import type { SceneNode, WorldMap } from './types'
import { usePlayer } from './usePlayer'
import { WorldCanvas } from './WorldCanvas'
import { FIXTURE_HREF, WorldPicker } from './WorldPicker'
import { buildWorld } from './worldgen'

/** `mentor_owl` -> `Mentor owl`. The enums are the label; there is no second table to drift. */
const humanise = (value: string) => {
  const words = value.replace(/_/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/**
 * `games.quest` is nullable: the backend persists a world whose generation only
 * partly succeeded. That is a state of its own, not a network failure, and it
 * gets its own screen.
 */
type Load =
  | { status: 'loading' }
  | { status: 'ready'; game: Game }
  | { status: 'picker' }
  | { status: 'empty'; title: string }
  | { status: 'error'; message: string; needsSignIn: boolean }

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
          ? { status: 'ready', game: fixtureQuest }
          : { status: 'picker' }

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
        setFetched({ id: worldId, value: { status: 'ready', game: quest } })
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setFetched({ id: worldId, value: { status: 'error', ...describe(error) } })
      })
    return () => {
      cancelled = true
    }
  }, [worldId])

  const game = load.status === 'ready' ? load.game : null

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
  const [completed, setCompleted] = useState<ReadonlySet<string>>(() => new Set<string>())
  const [openSceneId, setOpenSceneId] = useState<string | null>(null)
  const [answers, setAnswers] = useState<Record<string, string>>({})

  const player = usePlayer(map, { enabled: openSceneId === null })
  const panelRef = useRef<HTMLDivElement | null>(null)

  const nodeHere = useMemo<SceneNode | null>(() => {
    if (!map) return null
    return map.nodes.find((node) => node.at.x === player.tile.x && node.at.y === player.tile.y) ?? null
  }, [map, player.tile])

  const openNode = useMemo<SceneNode | null>(() => {
    if (!map || !openSceneId) return null
    return map.nodes.find((node) => node.sceneId === openSceneId) ?? null
  }, [map, openSceneId])

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

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpenSceneId(null)
        return
      }
      if (openSceneId !== null) return
      if (event.key !== 'e' && event.key !== 'E' && event.key !== 'Enter') return
      // Enter belongs to whatever control has focus, if any. `target` is not
      // always an Element (it can be the document, or the window for a
      // synthesised event), so the instance check is load-bearing.
      const target = event.target
      if (target instanceof Element && target.closest('button, a, input, textarea, select')) return
      if (!nodeHere) return
      event.preventDefault()
      setOpenSceneId(nodeHere.sceneId)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [nodeHere, openSceneId])

  // Move focus into the overlay so the keyboard follows the eye.
  useEffect(() => {
    if (openSceneId) panelRef.current?.focus()
  }, [openSceneId])

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

  const markComplete = (sceneId: string) => {
    setCompleted((current) => {
      if (current.has(sceneId)) return current
      const next = new Set(current)
      next.add(sceneId)
      return next
    })
  }

  const answer = (sceneId: string, optionId: string) => {
    setAnswers((current) => (current[sceneId] ? current : { ...current, [sceneId]: optionId }))
    markComplete(sceneId)
  }

  const close = () => setOpenSceneId(null)

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

        <div className="pointer-events-auto hidden rounded-2xl border border-white/10 bg-background/70 px-4 py-3 text-right text-xs font-semibold text-ink-muted backdrop-blur sm:block">
          <p>
            <kbd className="font-mono text-ink">WASD</kbd> / <kbd className="font-mono text-ink">arrows</kbd> to walk
          </p>
          <p className="mt-1">
            <kbd className="font-mono text-ink">E</kbd> to interact ·{' '}
            <kbd className="font-mono text-ink">Esc</kbd> to close
          </p>
        </div>
      </div>

      {/* Interaction prompt */}
      {nodeHere && !openSceneId && (
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
            className="stage-enter quest-panel relative w-full max-w-2xl rounded-2xl border border-white/10 bg-surface/95 p-6 shadow-2xl shadow-black/50 outline-none sm:p-8"
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
                chosenId={answers[openNode.sceneId] ?? null}
                onChoose={(optionId) => answer(openNode.sceneId, optionId)}
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
  chosenId,
  onChoose,
  onFinish,
}: {
  scene: Scene
  chosenId: string | null
  onChoose: (optionId: string) => void
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

  if (scene.type === 'prediction') {
    const chosen = scene.options.find((option) => option.id === chosenId) ?? null
    return (
      <div>
        <h3 className="text-xl font-black leading-tight text-ink">{scene.prompt}</h3>
        <ul className="mt-5 space-y-3">
          {scene.options.map((option) => (
            <li key={option.id}>
              <OptionButton
                option={option}
                chosen={chosenId === option.id}
                locked={chosen !== null}
                onSelect={() => onChoose(option.id)}
              />
            </li>
          ))}
        </ul>
        {chosen && (
          <div className="mt-6" aria-live="polite">
            <span
              className={`inline-flex rounded-full px-3 py-1.5 text-sm font-bold ${
                chosen.correct ? 'bg-secondary/10 text-secondary' : 'bg-primary/10 text-primary-soft'
              }`}
            >
              {chosen.correct ? 'That holds up.' : 'Wrong turn captured.'}
            </span>
            <p className="mt-4 leading-7 text-ink">{scene.reveal}</p>
            <button className="button-primary mt-6" onClick={onFinish}>
              Back to the world
            </button>
          </div>
        )}
      </div>
    )
  }

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

function OptionButton({
  option,
  chosen,
  locked,
  onSelect,
}: {
  option: Option
  chosen: boolean
  locked: boolean
  onSelect: () => void
}) {
  const tone = !locked
    ? 'border-white/12 bg-surface-high hover:border-secondary/50 hover:bg-surface-highest'
    : option.correct
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
      <span className="text-base font-semibold leading-6 text-ink">{option.text}</span>
      {locked && option.correct && <span className="ml-auto font-black text-secondary">✓</span>}
      {locked && chosen && !option.correct && <span className="ml-auto font-black text-primary-soft">✕</span>}
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
