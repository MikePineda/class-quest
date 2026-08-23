/**
 * Walking, as arithmetic. Pure, so it can be tested — the hook around it
 * cannot, and this is the part where a mistake makes the world feel wrong
 * rather than makes it crash.
 *
 * The one rule everything here serves: **adding a thumbstick must not change
 * what the keyboard does.** Not approximately, not imperceptibly. The keyboard
 * is how the world has been played and demoed, and a joystick is not worth a
 * gram of that.
 */
import type { Point } from './types'

export type Facing = 'down' | 'up' | 'left' | 'right'

/** Lowercased `event.key` → unit vector. */
export const KEY_VECTORS: Record<string, Point> = {
  arrowup: { x: 0, y: -1 },
  w: { x: 0, y: -1 },
  arrowdown: { x: 0, y: 1 },
  s: { x: 0, y: 1 },
  arrowleft: { x: -1, y: 0 },
  a: { x: -1, y: 0 },
  arrowright: { x: 1, y: 0 },
  d: { x: 1, y: 0 },
}

/** Frozen so the caller can compare identity and skip work. */
export const ZERO: Readonly<Point> = Object.freeze({ x: 0, y: 0 })

/** Travel, in CSS pixels, from the stick's origin to full tilt. */
export const STICK_RADIUS = 56
/** Below this the thumb is resting, not steering. */
export const STICK_DEAD_ZONE = 10
/**
 * The slowest a tilt can walk. Without a floor the first millimetre past the
 * dead zone is a sub-pixel crawl that reads as the stick being broken.
 */
export const STICK_FLOOR = 0.3

/**
 * This frame's intent, capped at unit length.
 *
 * `held` is the live key set, `analog` the stick — already dead-zoned, and
 * never longer than 1.
 *
 * The divisor is `max(1, hypot)` rather than `hypot`, and that is exactly
 * today's keyboard behaviour, not an approximation of it: key vectors are sums
 * of -1, 0 and 1, so whenever this line is reached the length is at least 1
 * and the `max` is the `hypot`. Diagonals still divide by √2. An analog vector
 * shorter than 1 divides by 1 and passes through, which is what makes a small
 * tilt a slow walk. Key and stick together saturate at 1, so touch can never
 * outrun the keyboard.
 */
export function resolveIntent(held: Iterable<string>, analog: Readonly<Point>): Point {
  let ix = analog.x
  let iy = analog.y
  for (const key of held) {
    const vector = KEY_VECTORS[key]
    if (!vector) continue
    ix += vector.x
    iy += vector.y
  }
  if (ix === 0 && iy === 0) return ZERO
  const divisor = Math.max(1, Math.hypot(ix, iy))
  return { x: ix / divisor, y: iy / divisor }
}

/**
 * Facing follows intent, not the resolved move, so sliding along a wall does
 * not spin the sprite. An exact diagonal resolves to vertical, and no intent
 * at all leaves the sprite looking where it was.
 */
export function facingFrom(x: number, y: number, previous: Facing): Facing {
  if (Math.abs(x) > Math.abs(y)) return x > 0 ? 'right' : 'left'
  if (y !== 0) return y > 0 ? 'down' : 'up'
  return previous
}

/**
 * Drag offset in CSS pixels → intent. Screen axes and tile axes agree: down
 * the screen is +y in both.
 */
export function stickVector(
  dx: number,
  dy: number,
  radius: number = STICK_RADIUS,
  deadZone: number = STICK_DEAD_ZONE,
  floor: number = STICK_FLOOR,
): Point {
  const distance = Math.hypot(dx, dy)
  if (distance <= deadZone) return ZERO
  const travel = Math.min(1, (distance - deadZone) / (radius - deadZone))
  const magnitude = floor + (1 - floor) * travel
  return { x: (dx / distance) * magnitude, y: (dy / distance) * magnitude }
}

/** Where to draw the knob: the drag, clipped to the ring. Rendering only. */
export function clampToRadius(dx: number, dy: number, radius: number = STICK_RADIUS): Point {
  const distance = Math.hypot(dx, dy)
  if (distance <= radius || distance === 0) return { x: dx, y: dy }
  return { x: (dx / distance) * radius, y: (dy / distance) * radius }
}
