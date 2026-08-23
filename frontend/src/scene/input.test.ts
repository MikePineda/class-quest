/**
 * The keyboard is how this world has been played and demoed, so the first test
 * here is not about the joystick at all: it is a copy of the movement maths as
 * it was before the stick existed, asserted against the new version for every
 * combination of keys a person can physically hold. Adding analog input was
 * only allowed to be free.
 */
import { describe, expect, it } from 'vitest'
import {
  clampToRadius,
  facingFrom,
  KEY_VECTORS,
  resolveIntent,
  STICK_DEAD_ZONE,
  STICK_FLOOR,
  STICK_RADIUS,
  stickVector,
  ZERO,
} from './input'

/** Verbatim copy of the pre-joystick expression. Do not "improve" it. */
function legacy(keys: readonly string[]): { x: number; y: number } {
  let ix = 0
  let iy = 0
  for (const key of keys) {
    const vector = KEY_VECTORS[key]
    if (!vector) continue
    ix += vector.x
    iy += vector.y
  }
  if (ix === 0 && iy === 0) return { x: 0, y: 0 }
  const length = Math.hypot(ix, iy)
  return { x: ix / length, y: iy / length }
}

describe('resolveIntent — keyboard', () => {
  it('is identical to the old normalisation for all 256 key combinations', () => {
    const names = Object.keys(KEY_VECTORS)
    expect(names).toHaveLength(8)
    for (let mask = 0; mask < 1 << names.length; mask++) {
      const keys = names.filter((_, index) => mask & (1 << index))
      expect(resolveIntent(new Set(keys), ZERO)).toEqual(legacy(keys))
    }
  })

  it('does not make a diagonal faster than a cardinal', () => {
    const cardinal = resolveIntent(new Set(['d']), ZERO)
    const diagonal = resolveIntent(new Set(['w', 'd']), ZERO)
    expect(Math.hypot(cardinal.x, cardinal.y)).toBeCloseTo(1, 12)
    expect(Math.hypot(diagonal.x, diagonal.y)).toBeCloseTo(1, 12)
  })

  it('cancels opposing keys and ignores unknown ones', () => {
    expect(resolveIntent(new Set(['a', 'd']), ZERO)).toBe(ZERO)
    expect(resolveIntent(new Set(['q', 'shift']), ZERO)).toBe(ZERO)
    expect(resolveIntent(new Set([]), ZERO)).toBe(ZERO)
  })
})

describe('resolveIntent — analog', () => {
  it('keeps a partial tilt partial, which is what makes a slow walk slow', () => {
    expect(resolveIntent(new Set(), { x: 0.4, y: 0 })).toEqual({ x: 0.4, y: 0 })
    const soft = resolveIntent(new Set(), { x: 0.3, y: 0.3 })
    expect(Math.hypot(soft.x, soft.y)).toBeCloseTo(Math.hypot(0.3, 0.3), 12)
  })

  it('leaves a full tilt at full speed', () => {
    const full = resolveIntent(new Set(), { x: Math.SQRT1_2, y: Math.SQRT1_2 })
    expect(Math.hypot(full.x, full.y)).toBeCloseTo(1, 12)
  })

  it('clamps an over-unit vector, so a caller bug cannot speed-hack', () => {
    const hacked = resolveIntent(new Set(), { x: 5, y: 0 })
    expect(hacked).toEqual({ x: 1, y: 0 })
  })

  it('caps key and stick pushing the same way at keyboard speed', () => {
    const both = resolveIntent(new Set(['d']), { x: 1, y: 0 })
    expect(Math.hypot(both.x, both.y)).toBeCloseTo(1, 12)
  })

  it('lets a stick cancel a held key', () => {
    expect(resolveIntent(new Set(['d']), { x: -1, y: 0 })).toBe(ZERO)
  })
})

describe('facingFrom', () => {
  it('reads each cardinal', () => {
    expect(facingFrom(1, 0, 'down')).toBe('right')
    expect(facingFrom(-1, 0, 'down')).toBe('left')
    expect(facingFrom(0, 1, 'up')).toBe('down')
    expect(facingFrom(0, -1, 'down')).toBe('up')
  })

  it('breaks an exact diagonal towards the vertical, as it always has', () => {
    expect(facingFrom(Math.SQRT1_2, Math.SQRT1_2, 'left')).toBe('down')
    expect(facingFrom(-Math.SQRT1_2, -Math.SQRT1_2, 'right')).toBe('up')
  })

  it('keeps the previous facing when there is no intent', () => {
    expect(facingFrom(0, 0, 'left')).toBe('left')
  })
})

describe('stickVector', () => {
  it('is dead inside the dead zone', () => {
    expect(stickVector(0, 0)).toBe(ZERO)
    expect(stickVector(STICK_DEAD_ZONE - 1, 0)).toBe(ZERO)
    expect(stickVector(STICK_DEAD_ZONE, 0)).toBe(ZERO)
  })

  it('starts at the floor rather than at zero, just past the dead zone', () => {
    const nudge = stickVector(STICK_DEAD_ZONE + 0.001, 0)
    expect(Math.hypot(nudge.x, nudge.y)).toBeCloseTo(STICK_FLOOR, 4)
  })

  it('reaches full tilt at the radius and never passes it', () => {
    expect(Math.hypot(...Object.values(stickVector(STICK_RADIUS, 0)) as [number, number])).toBeCloseTo(1, 12)
    const overshoot = stickVector(STICK_RADIUS * 3, 0)
    expect(Math.hypot(overshoot.x, overshoot.y)).toBeCloseTo(1, 12)
    expect(overshoot.y).toBe(0)
  })

  it('preserves the direction the thumb is pointing', () => {
    const up = stickVector(0, -STICK_RADIUS)
    expect(up.x).toBe(0)
    expect(up.y).toBeCloseTo(-1, 12)
    const diagonal = stickVector(-30, 30)
    expect(diagonal.x).toBeCloseTo(-diagonal.y, 12)
  })
})

describe('clampToRadius', () => {
  it('leaves a knob inside the ring exactly where it is', () => {
    expect(clampToRadius(10, -12)).toEqual({ x: 10, y: -12 })
    expect(clampToRadius(0, 0)).toEqual({ x: 0, y: 0 })
  })

  it('pins a knob outside the ring to the ring', () => {
    const pinned = clampToRadius(400, 300)
    expect(Math.hypot(pinned.x, pinned.y)).toBeCloseTo(STICK_RADIUS, 9)
  })
})
