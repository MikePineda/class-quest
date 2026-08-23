/**
 * Framing regressions, in both directions.
 *
 * The desktop numbers are literals on purpose: they are what the world has
 * been demoed at, they are quoted in `hubgen.ts`'s block comment, and the
 * portrait fix is only acceptable because it leaves every one of them alone.
 */
import { describe, expect, it } from 'vitest'
import { clampCamera, MAX_SCALE, MIN_SCALE, pickScale } from './camera'
import { TILE } from './types'

/** The hub `hubgen` builds: 24x14 interior plus a 2-tile margin. */
const HUB_W = 28
const HUB_H = 18

const scaleAt = (w: number, h: number) => pickScale(w, h, HUB_W, HUB_H)
const tilesAcross = (w: number, h: number) => w / scaleAt(w, h) / TILE

describe('pickScale — desktop must not move', () => {
  it.each([
    ['1280x720', 1280, 720, 3],
    ['1366x768', 1366, 768, 4],
    ['1440x900', 1440, 900, 4],
    ['1920x1080', 1920, 1080, 5],
    ['2560x1440', 2560, 1440, 6],
    ['1024x768 tablet landscape', 1024, 768, 3],
    ['844x390 phone landscape', 844, 390, 2],
  ])('%s stays at %d', (_label, width, height, expected) => {
    expect(scaleAt(width, height)).toBe(expected)
  })
})

describe('pickScale — portrait is playable', () => {
  it.each([
    ['iPhone', 390, 844],
    ['iPhone Pro Max', 430, 932],
    ['Pixel', 412, 915],
    ['iPhone SE', 375, 667],
    ['iPad', 768, 1024],
  ])('%s shows enough of the room to find a gate', (_label, width, height) => {
    // The hub puts its side gates eight tiles either side of spawn. Below
    // about twelve tiles across, walking is guesswork.
    expect(tilesAcross(width, height)).toBeGreaterThan(11.5)
  })

  it('is a real improvement on the widths that were worst', () => {
    // 412x915 used to pick 4, i.e. 6.4 tiles of a 28-tile map.
    expect(scaleAt(412, 915)).toBe(2)
    expect(scaleAt(390, 844)).toBe(2)
    // The tablet gains a third more room without dropping to phone scale.
    expect(scaleAt(768, 1024)).toBe(3)
  })
})

describe('pickScale — bounds', () => {
  it('never leaves the integer range the art is cut for', () => {
    for (const [w, h] of [[120, 90], [320, 240], [8000, 6000], [1, 1]]) {
      const scale = scaleAt(w, h)
      expect(Number.isInteger(scale)).toBe(true)
      expect(scale).toBeGreaterThanOrEqual(MIN_SCALE)
      expect(scale).toBeLessThanOrEqual(MAX_SCALE)
    }
  })

  it('still covers a viewport the map comfortably fills', () => {
    // A wide, short view: cover should win and there is no letterbox.
    expect(scaleAt(1280, 400)).toBeGreaterThanOrEqual(2)
  })
})

describe('clampCamera', () => {
  it('follows the player in the middle of a large world', () => {
    expect(clampCamera(500, 400, 2000)).toBe(500)
  })

  it('stops at both edges rather than showing the void', () => {
    expect(clampCamera(-80, 400, 2000)).toBe(0)
    expect(clampCamera(5000, 400, 2000)).toBe(1600)
  })

  it('centres a world smaller than the view, which is what makes the portrait letterbox symmetric', () => {
    expect(clampCamera(0, 800, 500)).toBe(-150)
    expect(clampCamera(9999, 800, 500)).toBe(-150)
  })
})
