/**
 * Turns a generated `Game` into a walkable tile map.
 *
 * Pure and deterministic by contract: no clock, no `Math.random`, no DOM, no
 * React. The same `game` always yields a byte-identical `WorldMap`, which is
 * what lets the renderer be tested without a canvas and lets a player reload
 * mid-run without the world shifting under them.
 *
 * The layout is one room per chapter, chained left to right. `game.chapters`
 * arrives in prerequisite-respecting order (the schema guarantees it), so
 * walking rightwards *is* walking up the concept graph.
 *
 * Rooms are carved first and walls are derived second: every `VOID` tile that
 * touches a `FLOOR` tile becomes `WALL`. Doorways therefore fall out of the
 * corridor carving instead of being special-cased, and connectivity holds by
 * construction — a corridor is floor, so the wall pass can never seal it.
 */

import type { Actor, Chapter, Game, Prop, Scene } from '../api/types'
import { FLOOR, VOID, WALL } from './types'
import type { DecorPlacement, Point, Room, SceneNode, TileId, WorldMap } from './types'

/** Empty border kept around the whole map so the wall pass always has room. */
const MARGIN = 2
/** Interior height of every room. Constant, so the centre line is a single row. */
const ROOM_H = 11
/** Horizontal space between two rooms, filled by the corridor. */
const ROOM_GAP = 5
/** Corridor height in tiles, centred on the room centre row. */
const CORRIDOR_H = 3
const MIN_ROOM_W = 11
const MAX_ROOM_W = 31
/** Scenes that are not dialogue are asked by the mascot. */
const MASCOT: Actor = 'mentor_owl'
/** How many decor sprites the renderer may pick from a biome's `decor` list. */
const DECOR_SPRITES = 4
/** Roughly one decor per this many candidate floor tiles. */
const TILES_PER_DECOR = 18

const clamp = (value: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, value))

/** Interior width grows with scene count so busy chapters are not cramped. */
const roomWidth = (sceneCount: number): number => clamp(sceneCount * 4 + 5, MIN_ROOM_W, MAX_ROOM_W)

/** FNV-1a over the game id: a stable 32-bit seed with no dependency. */
function hashString(text: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/** mulberry32: small, fast, good enough for scattering rocks. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Dialogue scenes are spoken by their speaker; the rest are the mascot's questions. */
const actorFor = (scene: Scene): Actor => (scene.type === 'dialogue' ? scene.speaker : MASCOT)

/** `SimulationScene` has no `props` field at all, hence the `in` check. */
const propsFor = (scene: Scene): Prop[] => ('props' in scene ? [...(scene.props ?? [])] : [])

/**
 * Where the scenes of one room sit along its centre line: evenly spread, and
 * strictly increasing so two scenes never land on the same tile.
 */
function sceneColumns(room: Room, count: number): number[] {
  const columns: number[] = []
  let previous = room.x - 1
  for (let i = 0; i < count; i++) {
    const even = room.x + Math.floor(((i + 1) * room.w) / (count + 1))
    const x = clamp(Math.max(even, previous + 1), room.x, room.x + room.w - 1)
    columns.push(x)
    previous = x
  }
  return columns
}

export function buildWorld(game: Game): WorldMap {
  const chapters: Chapter[] = game.chapters

  // --- rooms ---------------------------------------------------------------
  const rooms: Room[] = []
  let cursorX = MARGIN
  for (const chapter of chapters) {
    const w = roomWidth(chapter.scenes.length)
    rooms.push({
      chapterId: chapter.id,
      title: chapter.title,
      background: chapter.background,
      x: cursorX,
      y: MARGIN,
      w,
      h: ROOM_H,
    })
    cursorX += w + ROOM_GAP
  }

  const lastRoom = rooms[rooms.length - 1]
  const width = (lastRoom ? lastRoom.x + lastRoom.w : MARGIN) + MARGIN
  const height = MARGIN * 2 + ROOM_H
  const tiles = new Uint8Array(width * height) // starts as all VOID (0)
  const set = (x: number, y: number, tile: TileId): void => {
    tiles[y * width + x] = tile
  }
  const get = (x: number, y: number): TileId =>
    x < 0 || y < 0 || x >= width || y >= height ? VOID : (tiles[y * width + x] as TileId)

  // --- carve ---------------------------------------------------------------
  for (const room of rooms) {
    for (let y = room.y; y < room.y + room.h; y++) {
      for (let x = room.x; x < room.x + room.w; x++) set(x, y, FLOOR)
    }
  }

  const centreY = MARGIN + Math.floor(ROOM_H / 2)
  const corridorTop = centreY - Math.floor(CORRIDOR_H / 2)
  for (let i = 0; i + 1 < rooms.length; i++) {
    const from = rooms[i]
    const to = rooms[i + 1]
    for (let x = from.x + from.w; x < to.x; x++) {
      for (let y = corridorTop; y < corridorTop + CORRIDOR_H; y++) set(x, y, FLOOR)
    }
  }

  // --- wall ----------------------------------------------------------------
  // Second pass on purpose: a void tile touching floor is a wall, everywhere,
  // with no special case for doorways. Writing WALL never creates new floor,
  // so doing it in place cannot cascade.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (get(x, y) !== VOID) continue
      const touchesFloor =
        get(x + 1, y) === FLOOR ||
        get(x - 1, y) === FLOOR ||
        get(x, y + 1) === FLOOR ||
        get(x, y - 1) === FLOOR
      if (touchesFloor) set(x, y, WALL)
    }
  }

  // --- nodes ---------------------------------------------------------------
  const nodes: SceneNode[] = []
  chapters.forEach((chapter, index) => {
    const room = rooms[index]
    const columns = sceneColumns(room, chapter.scenes.length)
    chapter.scenes.forEach((scene, i) => {
      nodes.push({
        sceneId: scene.id,
        chapterId: chapter.id,
        order: nodes.length,
        scene,
        actor: actorFor(scene),
        props: propsFor(scene),
        at: { x: columns[i], y: centreY },
      })
    })
  })

  const nodeKeys = new Set(nodes.map((node) => `${node.at.x},${node.at.y}`))

  // --- spawn ---------------------------------------------------------------
  // Near the left edge of the first room, on the centre line, so the player
  // faces the whole chapter. Nudged right in the impossible case of a clash.
  const firstRoom = rooms[0]
  const spawn: Point = firstRoom
    ? { x: firstRoom.x + 1, y: centreY }
    : { x: Math.floor(width / 2), y: centreY }
  while (
    firstRoom &&
    nodeKeys.has(`${spawn.x},${spawn.y}`) &&
    spawn.x < firstRoom.x + firstRoom.w - 1
  ) {
    spawn.x += 1
  }

  // --- decor ---------------------------------------------------------------
  // Candidates are room-interior floor tiles off the centre line: never a
  // corridor, never a node, never the spawn, and never on the row the player
  // walks, so nothing the player needs is ever visually buried.
  const candidates: Point[] = []
  for (const room of rooms) {
    for (let y = room.y; y < room.y + room.h; y++) {
      if (y === centreY) continue
      for (let x = room.x; x < room.x + room.w; x++) {
        if (nodeKeys.has(`${x},${y}`)) continue
        if (x === spawn.x && y === spawn.y) continue
        candidates.push({ x, y })
      }
    }
  }

  const random = mulberry32(hashString(game.game_id))
  // Fisher-Yates over a copy, then take the head: distinct tiles, one pass.
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    const swap = candidates[i]
    candidates[i] = candidates[j]
    candidates[j] = swap
  }
  const decorCount = Math.min(candidates.length, Math.floor(candidates.length / TILES_PER_DECOR))
  const decor: DecorPlacement[] = []
  for (let i = 0; i < decorCount; i++) {
    decor.push({ sprite: String(Math.floor(random() * DECOR_SPRITES)), at: candidates[i] })
  }

  return {
    gameId: game.game_id,
    title: game.title,
    width,
    height,
    tiles,
    rooms,
    nodes,
    decor,
    // A chapter map has no portals. The field exists so both generators satisfy
    // one WorldMap shape; the hub is built by `hubgen.ts`.
    portals: [],
    spawn,
  }
}
