/**
 * The contract between the three halves of the world renderer.
 *
 * `worldgen` turns a Game into a WorldMap (pure, deterministic, no DOM).
 * `vocabulary` turns the schema's fixed enums into art (pure data, no DOM).
 * `WorldCanvas` draws a WorldMap using that art and lets the player walk it.
 *
 * Keeping the shapes here means the three can be built and tested independently,
 * and neither of the pure modules ever imports React or touches an Image.
 */

import type { Actor, Background, Prop, Scene } from '../api/types'

/** Source pixels per tile. The art is authored at 16x16; the canvas scales up by an integer factor. */
export const TILE = 16

export const VOID = 0
export const FLOOR = 1
export const WALL = 2
/** `VOID` is out of bounds, `WALL` blocks movement, `FLOOR` is walkable. */
export type TileId = typeof VOID | typeof FLOOR | typeof WALL

/** Tile coordinates, not pixels. */
export interface Point {
  x: number
  y: number
}

/** One chapter, rendered as a room the player walks through. */
export interface Room {
  chapterId: string
  title: string
  background: Background
  /** Interior rect in tiles, walls excluded. */
  x: number
  y: number
  w: number
  h: number
}

/** One scene, rendered as a marker the player steps onto to open it. */
export interface SceneNode {
  sceneId: string
  chapterId: string
  /** Index across the whole game, in play order. Drives the "3 / 12" readout. */
  order: number
  scene: Scene
  /** Who is standing here. Dialogue scenes use their speaker; the rest use the mascot. */
  actor: Actor
  props: Prop[]
  at: Point
}

/** Scenery scattered for texture. Never blocks movement and never carries meaning. */
export interface DecorPlacement {
  /** Key into the biome's `decor` list. */
  sprite: string
  at: Point
}

export interface WorldMap {
  /** Mirrors the Game it was built from, so a renderer can label the world. */
  gameId: string
  title: string
  width: number
  height: number
  /** Row-major, `width * height` entries of `TileId`. */
  tiles: Uint8Array
  rooms: Room[]
  nodes: SceneNode[]
  decor: DecorPlacement[]
  /** Where the player starts. Always a floor tile inside the first room. */
  spawn: Point
}

export const tileAt = (map: WorldMap, x: number, y: number): TileId =>
  x < 0 || y < 0 || x >= map.width || y >= map.height
    ? VOID
    : (map.tiles[y * map.width + x] as TileId)

// --- art -------------------------------------------------------------------

/** A sprite sheet of `frames` square frames laid out left to right. */
export interface Anim {
  src: string
  /** Frame width and height in source pixels. Idle sheets are 32, run sheets 64. */
  frame: number
  frames: number
  fps: number
}

/** A single still image. `w`/`h` are its source pixel size. */
export interface Still {
  src: string
  w: number
  h: number
}

/**
 * What a `background` looks like on the ground. Every value of the enum has a
 * real biome — there are no fallbacks, because the pack covers all six.
 */
export interface Biome {
  floor: Still
  /** Walls are drawn in two pieces so they read as height from above. */
  wallTop: Still
  wallFace: Still
  /** Scattered on open floor for texture. Empty is allowed. */
  decor: Still[]
  /** Multiplied over the room to give each chapter its own light. */
  tint: string
}

export interface ActorArt {
  idle: Anim
  /** Absent for actors that never move, like the mascot. */
  run?: Anim
}

/** `chart_frame` is drawn in code rather than blitted: it frames a real plotted curve. */
export type PropArt = { kind: 'sprite'; sprite: Still } | { kind: 'component'; component: 'chart_frame' }

export type Biomes = Record<Background, Biome>
export type ActorArts = Record<Actor, ActorArt>
export type PropArts = Record<Prop, PropArt>
