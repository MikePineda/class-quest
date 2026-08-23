/**
 * How much of the world fits on screen, and where the view sits in it.
 *
 * Pulled out of `WorldCanvas` so the framing can be tested. It is worth
 * testing: the numbers are invisible until somebody opens the app on a phone
 * and finds the room has become a corridor.
 */
import { TILE } from './types'

/** Roughly how many tiles we want across the viewport before picking the integer scale. */
const TARGET_TILES_ACROSS = 26
const TARGET_TILES_DOWN = 15

/**
 * The framing that covering the map may never cross.
 *
 * `cover` used to have the last word, and on a tall screen it spent the whole
 * budget on the short axis: a 412x915 phone picked scale 4 and showed 6.4
 * tiles of a 28-tile room, with both side gates off screen. A phone held
 * upright cannot show 26x15 tiles at any legible size, so below these counts
 * the map is allowed to letterbox instead.
 *
 * The letterbox is not the eyesore the old comment feared: the canvas is
 * cleared to #05080f and the screen-space vignette already fades the edges to
 * the same colour, so the band reads as the cave going dark. In portrait it is
 * also exactly where the HUD and the thumbstick sit.
 */
const MIN_TILES_ACROSS = 14
const MIN_TILES_DOWN = 9

export const MIN_SCALE = 2
export const MAX_SCALE = 6

/**
 * The integer zoom. Start from how many tiles we want on screen, zoom in far
 * enough to cover the viewport if that is possible, and never zoom past the
 * point where the room stops reading as a room.
 */
export function pickScale(width: number, height: number, mapWidth: number, mapHeight: number): number {
  const preferred = Math.floor(
    Math.min(width / (TILE * TARGET_TILES_ACROSS), height / (TILE * TARGET_TILES_DOWN)),
  )
  const cover = Math.ceil(Math.max(width / (mapWidth * TILE), height / (mapHeight * TILE)))
  const room = Math.floor(
    Math.min(width / (TILE * MIN_TILES_ACROSS), height / (TILE * MIN_TILES_DOWN)),
  )
  // `preferred` floors to 0 on any phone, which is why it used to be discarded
  // with `|| MIN_SCALE` — and discarding it is what let `cover` run unopposed.
  // The final clamp covers the zero case honestly.
  const scale = Math.min(Math.max(preferred, cover), room)
  return Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale))
}

/**
 * Where the camera sits on one axis: centred on the player, stopped at the
 * edges, and centred outright when the world is smaller than the view.
 */
export const clampCamera = (value: number, view: number, world: number): number =>
  world <= view ? (world - view) / 2 : Math.min(Math.max(value, 0), world - view)
