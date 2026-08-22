/**
 * Builds the portal hub: one cave room, the player in the middle, a ring of
 * doorways around them.
 *
 * Pure and deterministic by contract: no clock, no `Math.random`, no DOM, no
 * React. The same input always yields a byte-identical `WorldMap`, which lets
 * the renderer be tested without a canvas and lets a player reload mid-run
 * without the world shifting under them.
 *
 * Deliberately decoupled from the content types: this module never imports
 * `Game`, `Chapter` or `Scene`. A hub is a fixed piece of level geometry that
 * happens to carry four labels, so the caller hands it labels rather than
 * content. That is what keeps it stable while the panels behind the portals
 * change shape.
 *
 * As in `worldgen`, the interior is carved first and walls are derived second:
 * every `VOID` tile that touches a `FLOOR` tile becomes `WALL`. The pass is
 * layout-independent, so it stays correct if the room ever changes size.
 */

import type { Actor, Background } from '../api/types'
import { FLOOR, VOID, WALL } from './types'
import type {
  DecorPlacement,
  Point,
  PortalKind,
  PortalNode,
  Rect,
  Room,
  TileId,
  WorldMap,
} from './types'

/** Empty border kept around the map so the wall pass always has room. */
const MARGIN = 2
/**
 * Interior size in tiles. A hub is a lobby, not a field: at 30x18 it read as
 * empty, so the room is deliberately tight and the walk to a gate is short.
 *
 * Verified against `WorldCanvas.pickScale` (`TARGET_TILES_ACROSS = 26`,
 * `TARGET_TILES_DOWN = 15`, `MIN_SCALE = 2`, `MAX_SCALE = 6`), which takes the
 * larger of the preferred scale and the scale that covers the viewport. At a
 * 28x18 map: 1280x720 picks 3 (1344x864 covers), 1920x1080 picks 5 (2240x1440
 * covers), 2560x1440 picks 6 (2688x1728 covers). Past ~2688 CSS px wide the
 * `MAX_SCALE` clamp letterboxes regardless of map size, as it already did.
 * Do not shrink below roughly 24x14 or the black bars come back at 1440p.
 */
const INTERIOR_W = 24
const INTERIOR_H = 14

const MAP_W = INTERIOR_W + MARGIN * 2
const MAP_H = INTERIOR_H + MARGIN * 2

/**
 * Hotspot size. Three wide because at 5.4 tiles/s a one-tile target is
 * genuinely hard to land on, two deep so it triggers on approach rather than
 * only once the player is level with the arch.
 */
const HOTSPOT_W = 3
const HOTSPOT_H = 2

/**
 * Roughly one decor sprite per this many candidate floor tiles. Denser than the
 * old 18 on purpose: a smaller room with the same density is just a smaller
 * empty room.
 */
const TILES_PER_DECOR = 11
/**
 * How many decor sprites the generator may pick from a biome's `decor` list.
 * Kept at 2 rather than `worldgen`'s 4: no biome in `vocabulary` carries more
 * than two, and `WorldCanvas.resolveDecor` silently drops an out-of-range
 * index, which would quietly thin the scatter.
 */
const DECOR_SPRITES = 2

/**
 * Where the portals stand, as offsets from the spawn tile, in slot order.
 * `input.portals` maps onto these by index, so the caller controls which mode
 * of learning gets which corner by ordering its list.
 */
const SLOT_OFFSETS: readonly Point[] = [
  { x: -8, y: -3 }, // slot 0 — left
  { x: 0, y: -5 }, // slot 1 — far side
  { x: 8, y: -3 }, // slot 2 — right
  { x: 0, y: 4 }, // slot 3 — behind the player
]

/**
 * Where a guide stands relative to its arch: two tiles to the right, on the
 * anchor row. Two rather than one so the guide clears the 3-wide hotspot, and
 * the same for every slot so the renderer can derive the tile from `at` without
 * the map having to carry a second point. Use `guideTileFor`, never a literal.
 */
const GUIDE_OFFSET: Point = { x: 2, y: 0 }

/**
 * Who stands beside each gate. Decoration with a job: the villager is the one
 * who tells you things, the rival is the one who tests you, the owl is the one
 * that asks you why. A sealed gate has nobody — there is nothing to explain yet.
 */
const GUIDE_BY_KIND: Record<PortalKind, Actor | null> = {
  storybook: 'villager',
  quiz: 'rival',
  explain: 'mentor_owl',
  sealed: null,
}

/**
 * The floor tile a portal's guide stands on. Exported because the guide is not
 * a `SceneNode` and carries no point of its own: the renderer needs this to
 * draw it, and the decor scatter needs it to stay off the tile.
 */
export const guideTileFor = (portal: PortalNode): Point => ({
  x: portal.at.x + GUIDE_OFFSET.x,
  y: portal.at.y + GUIDE_OFFSET.y,
})

/** One doorway the caller wants placed. Carries labels, never content. */
export interface HubPortalSpec {
  kind: PortalKind
  label: string
  blurb: string
  locked: boolean
}

export interface HubInput {
  /** Anything stable per world. Seeds the decor scatter and becomes `gameId`. */
  seed: string
  title: string
  background: Background
  /** Placed onto `SLOT_OFFSETS` by index; extras beyond the last slot are dropped. */
  portals: HubPortalSpec[]
}

/** FNV-1a over the seed: a stable 32-bit seed with no dependency. */
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

/**
 * The tiles a straight walk from `from` to `to` passes through (Bresenham,
 * 8-connected). Exported because the decor rules are defined in terms of it:
 * keeping the scatter off these tiles is what draws the radiating stone paths.
 */
export function pathLine(from: Point, to: Point): Point[] {
  const dx = Math.abs(to.x - from.x)
  const dy = Math.abs(to.y - from.y)
  const stepX = from.x < to.x ? 1 : -1
  const stepY = from.y < to.y ? 1 : -1
  let error = dx - dy
  let { x, y } = from
  const points: Point[] = [{ x, y }]
  while (x !== to.x || y !== to.y) {
    const doubled = error * 2
    if (doubled > -dy) {
      error -= dy
      x += stepX
    }
    if (doubled < dx) {
      error += dx
      y += stepY
    }
    points.push({ x, y })
  }
  return points
}

const rectTiles = (rect: Rect): Point[] => {
  const out: Point[] = []
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) out.push({ x, y })
  }
  return out
}

export function buildHub(input: HubInput): WorldMap {
  const width = MAP_W
  const height = MAP_H
  const tiles = new Uint8Array(width * height) // starts as all VOID (0)
  const set = (x: number, y: number, tile: TileId): void => {
    tiles[y * width + x] = tile
  }
  const get = (x: number, y: number): TileId =>
    x < 0 || y < 0 || x >= width || y >= height ? VOID : (tiles[y * width + x] as TileId)

  // --- carve ---------------------------------------------------------------
  // The whole interior is one open floor. Nothing inside it ever blocks
  // movement, portals included: a solid arch can wedge the player against a
  // wall with no way out, and there is no unstick control.
  for (let y = MARGIN; y < MARGIN + INTERIOR_H; y++) {
    for (let x = MARGIN; x < MARGIN + INTERIOR_W; x++) set(x, y, FLOOR)
  }

  // --- wall ----------------------------------------------------------------
  // Second pass on purpose: a void tile touching floor is a wall, everywhere.
  // Writing WALL never creates new floor, so doing it in place cannot cascade.
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

  // --- room ----------------------------------------------------------------
  // Exactly one, covering the whole interior. This is load-bearing:
  // `WorldCanvas.buildRoomIndex` assigns every unclaimed tile to the nearest
  // room centre, so with a single room the floor, walls and tint all render.
  // A second room would black out every tile outside both rects.
  const rooms: Room[] = [
    {
      chapterId: 'hub',
      title: input.title,
      background: input.background,
      x: MARGIN,
      y: MARGIN,
      w: INTERIOR_W,
      h: INTERIOR_H,
    },
  ]

  // --- spawn ---------------------------------------------------------------
  const spawn: Point = {
    x: MARGIN + Math.floor(INTERIOR_W / 2),
    y: MARGIN + Math.floor(INTERIOR_H / 2),
  }

  // --- portals -------------------------------------------------------------
  const portals: PortalNode[] = input.portals
    .slice(0, SLOT_OFFSETS.length)
    .map((spec, index): PortalNode => {
      const offset = SLOT_OFFSETS[index]
      const at: Point = { x: spawn.x + offset.x, y: spawn.y + offset.y }
      const guide = GUIDE_BY_KIND[spec.kind]
      return {
        kind: spec.kind,
        label: spec.label,
        blurb: spec.blurb,
        at,
        hotspot: { x: at.x - 1, y: at.y, w: HOTSPOT_W, h: HOTSPOT_H },
        locked: spec.locked,
        // Purely decorative: the guide is not a node, blocks nothing and is
        // deliberately outside the hotspot, so walking up to a gate behaves
        // exactly as it did before anyone was standing there.
        ...(guide ? { guide } : {}),
      }
    })

  // --- decor ---------------------------------------------------------------
  // The radiating stone paths of the concept art are negative space in this
  // scatter, not a tile type: exclude the straight walk from spawn to each
  // anchor (dilated by one so the lane reads as a lane), the pad the player
  // spawns on, each hotspot with a one-tile skirt, and the tile each guide
  // stands on with the same skirt. What is left is rock.
  const blocked = new Set<string>()
  const blockAround = (point: Point): void => {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) blocked.add(`${point.x + dx},${point.y + dy}`)
    }
  }

  blockAround(spawn)
  for (const portal of portals) {
    for (const tile of pathLine(spawn, portal.at)) blockAround(tile)
    for (const tile of rectTiles(portal.hotspot)) blockAround(tile)
    if (portal.guide) blockAround(guideTileFor(portal))
  }

  const candidates: Point[] = []
  for (let y = MARGIN; y < MARGIN + INTERIOR_H; y++) {
    for (let x = MARGIN; x < MARGIN + INTERIOR_W; x++) {
      if (blocked.has(`${x},${y}`)) continue
      candidates.push({ x, y })
    }
  }

  const random = mulberry32(hashString(input.seed))
  // Fisher-Yates over the candidates, then take the head: distinct tiles, one pass.
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
    gameId: input.seed,
    title: input.title,
    width,
    height,
    tiles,
    rooms,
    // A hub carries no walkable scenes. Every existing `nodes` loop in the
    // renderer therefore iterates zero times and stays correct untouched.
    nodes: [],
    decor,
    portals,
    spawn,
  }
}
