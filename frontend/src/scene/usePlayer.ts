/**
 * Player movement over a `WorldMap`.
 *
 * Position is kept in a ref, not in React state, on purpose: the body moves
 * every animation frame and the canvas reads it from its own rAF loop, so
 * publishing it through React would re-render the tree 60 times a second for a
 * number nothing in the DOM displays. The one thing the DOM does care about is
 * which tile the player stands on — that is mirrored into state, and only when
 * it actually changes.
 *
 * Movement is held-key, not per-keydown: a key set plus a delta-timed loop, so
 * walking is smooth and key repeat never gates it. Collision resolves X and Y
 * independently, which is what makes the player slide along a wall instead of
 * sticking to it when walking diagonally into it.
 */

import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { FLOOR, tileAt } from './types'
import type { Point, WorldMap } from './types'

export type Facing = 'down' | 'up' | 'left' | 'right'

/** Live player state, in sub-tile float coordinates. Mutated in place by the loop. */
export interface PlayerBody {
  /** Tile coordinates of the point the player stands on. `2.5` is the centre of tile 2. */
  x: number
  y: number
  facing: Facing
  /** True while the player is actually displacing, which selects run over idle. */
  moving: boolean
}

export interface PlayerHandle {
  /** Read per frame by the renderer; never triggers a render. */
  body: RefObject<PlayerBody>
  /** The tile under the player. React state, updated only when it changes. */
  tile: Point
}

export interface PlayerOptions {
  /** Tiles per second. */
  speed?: number
  /** False freezes the player and drops every held key (used while an overlay is open). */
  enabled?: boolean
}

/**
 * The collision box, in tiles. Narrower than a tile so a one-tile doorway is
 * comfortably walkable, and shallow so the box sits around the feet rather than
 * around the whole sprite.
 */
const HALF_W = 0.3
const HALF_H = 0.26

const DEFAULT_SPEED = 5.4
/** Clamps the delta so a backgrounded tab does not teleport the player through a wall on return. */
const MAX_STEP_SECONDS = 1 / 20

const KEY_VECTORS: Record<string, Point> = {
  arrowup: { x: 0, y: -1 },
  w: { x: 0, y: -1 },
  arrowdown: { x: 0, y: 1 },
  s: { x: 0, y: 1 },
  arrowleft: { x: -1, y: 0 },
  a: { x: -1, y: 0 },
  arrowright: { x: 1, y: 0 },
  d: { x: 1, y: 0 },
}

/** Keys the browser would otherwise use to scroll the page under the canvas. */
const SCROLL_KEYS = new Set(['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' ', 'spacebar'])

/**
 * True while the person is typing into something.
 *
 * These listeners are on `window`, so they see every keystroke in the document,
 * including the ones meant for a textarea in a panel above the canvas. Without
 * this check the space bar is swallowed by the anti-scroll `preventDefault` and
 * the learner cannot put spaces in a sentence they are writing.
 */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable
}

const isSolid = (map: WorldMap, x: number, y: number): boolean =>
  tileAt(map, Math.floor(x), Math.floor(y)) !== FLOOR

/** The box is smaller than a tile, so its four corners cover every tile it can touch. */
function blocked(map: WorldMap, cx: number, cy: number): boolean {
  const left = cx - HALF_W
  const right = cx + HALF_W
  const top = cy - HALF_H
  const bottom = cy + HALF_H
  return (
    isSolid(map, left, top) ||
    isSolid(map, right, top) ||
    isSolid(map, left, bottom) ||
    isSolid(map, right, bottom)
  )
}

export function usePlayer(map: WorldMap | null, options: PlayerOptions = {}): PlayerHandle {
  const { speed = DEFAULT_SPEED, enabled = true } = options

  const body = useRef<PlayerBody>({ x: 0, y: 0, facing: 'down', moving: false })
  const [tile, setTile] = useState<Point>(() => (map ? { x: map.spawn.x, y: map.spawn.y } : { x: 0, y: 0 }))

  // Read inside the loop so toggling either never tears down the listeners.
  const enabledRef = useRef(enabled)
  const speedRef = useRef(speed)
  useEffect(() => {
    enabledRef.current = enabled
    speedRef.current = speed
  }, [enabled, speed])

  const held = useRef<Set<string>>(new Set())

  useEffect(() => {
    if (!map) return

    const keys = held.current
    keys.clear()

    // Spawn is part of the map: a new map means a new starting tile. The first
    // frame publishes the tile, so no render is needed here.
    body.current.x = map.spawn.x + 0.5
    body.current.y = map.spawn.y + 0.5
    body.current.facing = 'down'
    body.current.moving = false

    const keyName = (event: KeyboardEvent) => event.key.toLowerCase()

    const onKeyDown = (event: KeyboardEvent) => {
      // Typing wins over walking, always. WASD is also ordinary prose.
      if (isTyping(event.target)) return
      const key = keyName(event)
      // The page must never scroll under the world.
      if (SCROLL_KEYS.has(key)) event.preventDefault()
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (key in KEY_VECTORS) keys.add(key)
    }

    const onKeyUp = (event: KeyboardEvent) => {
      // Not gated on `isTyping`: a key held before focus moved into a field
      // still has to be released, or the player walks into a wall forever.
      keys.delete(keyName(event))
    }

    // A key held while the window loses focus never sends its keyup, which would
    // leave the player walking into a wall forever.
    const release = () => keys.clear()

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', release)
    document.addEventListener('visibilitychange', release)

    let frame = 0
    let last = performance.now()

    const step = (now: number) => {
      frame = requestAnimationFrame(step)
      const dt = Math.min((now - last) / 1000, MAX_STEP_SECONDS)
      last = now

      const player = body.current

      const publishTile = () => {
        const tx = Math.floor(player.x)
        const ty = Math.floor(player.y)
        setTile((current) => (current.x === tx && current.y === ty ? current : { x: tx, y: ty }))
      }

      if (!enabledRef.current) {
        keys.clear()
        player.moving = false
        publishTile()
        return
      }

      let ix = 0
      let iy = 0
      for (const key of keys) {
        const vector = KEY_VECTORS[key]
        if (!vector) continue
        ix += vector.x
        iy += vector.y
      }

      if (ix === 0 && iy === 0) {
        player.moving = false
        publishTile()
        return
      }

      // Normalise so diagonals are not faster than the cardinals.
      const length = Math.hypot(ix, iy)
      const distance = speedRef.current * dt
      const dx = (ix / length) * distance
      const dy = (iy / length) * distance

      // Facing follows intent, not the resolved move, so sliding along a wall
      // does not spin the sprite around.
      if (Math.abs(ix) > Math.abs(iy)) player.facing = ix > 0 ? 'right' : 'left'
      else if (iy !== 0) player.facing = iy > 0 ? 'down' : 'up'

      const fromX = player.x
      const fromY = player.y

      // Axis-separated resolution: this is what lets the player slide.
      if (dx !== 0 && !blocked(map, player.x + dx, player.y)) player.x += dx
      if (dy !== 0 && !blocked(map, player.x, player.y + dy)) player.y += dy

      player.moving = Math.abs(player.x - fromX) > 1e-4 || Math.abs(player.y - fromY) > 1e-4
      publishTile()
    }

    frame = requestAnimationFrame(step)

    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', release)
      document.removeEventListener('visibilitychange', release)
      keys.clear()
    }
  }, [map])

  return { body, tile }
}
