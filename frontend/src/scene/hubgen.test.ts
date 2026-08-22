import { describe, expect, it } from 'vitest'

import { FLOOR, VOID, WALL, tileAt } from './types'
import type { Point, PortalKind, Rect, WorldMap } from './types'
import { buildHub, pathLine } from './hubgen'
import type { HubInput, HubPortalSpec } from './hubgen'

const SPECS: HubPortalSpec[] = [
  { kind: 'storybook', label: 'Storybook', blurb: 'Read the theory.', locked: false },
  { kind: 'quiz', label: 'Quiz', blurb: 'Answer under pressure.', locked: false },
  { kind: 'explain', label: 'Explain to Win', blurb: 'Teach it back.', locked: false },
  { kind: 'sealed', label: 'Sealed', blurb: 'Coming soon.', locked: true },
]

const input = (over: Partial<HubInput> = {}): HubInput => ({
  seed: 'world0001',
  title: 'Overfitting and Generalisation',
  background: 'cavern',
  portals: SPECS,
  ...over,
})

const key = (p: Point): string => `${p.x},${p.y}`

const rectTiles = (r: Rect): Point[] => {
  const out: Point[] = []
  for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) out.push({ x, y })
  return out
}

/** Every FLOOR tile reachable from `from` by orthogonal steps. */
function flood(map: WorldMap, from: Point): Set<string> {
  const seen = new Set<string>()
  if (tileAt(map, from.x, from.y) !== FLOOR) return seen
  const queue: Point[] = [from]
  seen.add(key(from))
  while (queue.length > 0) {
    const p = queue.pop() as Point
    const neighbours: Point[] = [
      { x: p.x + 1, y: p.y },
      { x: p.x - 1, y: p.y },
      { x: p.x, y: p.y + 1 },
      { x: p.x, y: p.y - 1 },
    ]
    for (const n of neighbours) {
      const k = key(n)
      if (seen.has(k)) continue
      if (tileAt(map, n.x, n.y) !== FLOOR) continue
      seen.add(k)
      queue.push(n)
    }
  }
  return seen
}

describe('buildHub', () => {
  const map = buildHub(input())

  it('is 34 x 22 tiles, holding only void, wall and floor', () => {
    // 30x18 interior plus a 2-tile margin. Verified against WorldCanvas.pickScale:
    // it covers 1280/1920/2560-wide viewports without letterboxing. Shrinking
    // below ~28x16 reintroduces the letterbox.
    expect(map.width).toBe(34)
    expect(map.height).toBe(22)
    expect(map.tiles).toHaveLength(map.width * map.height)
    for (const tile of map.tiles) expect([VOID, FLOOR, WALL]).toContain(tile)
  })

  it('walls every void tile that touches floor', () => {
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        if (tileAt(map, x, y) !== VOID) continue
        const touchesFloor =
          tileAt(map, x + 1, y) === FLOOR ||
          tileAt(map, x - 1, y) === FLOOR ||
          tileAt(map, x, y + 1) === FLOOR ||
          tileAt(map, x, y - 1) === FLOOR
        expect(touchesFloor).toBe(false)
      }
    }
  })

  it('emits exactly one room, covering the whole interior', () => {
    // Load-bearing, not cosmetic: WorldCanvas.buildRoomIndex assigns every
    // unclaimed tile to the nearest room centre. With one room every leftover
    // tile resolves to index 0, so floor, walls and tint all draw. Carve a
    // second room and every tile outside both rects renders black.
    expect(map.rooms).toHaveLength(1)
    expect(map.rooms[0]).toMatchObject({ x: 2, y: 2, w: 30, h: 18, background: 'cavern' })
    expect(map.nodes).toEqual([])
  })

  it('spawns dead centre on a floor tile inside the interior', () => {
    expect(map.spawn).toEqual({ x: 17, y: 11 })
    expect(tileAt(map, map.spawn.x, map.spawn.y)).toBe(FLOOR)
    const room = map.rooms[0]
    expect(map.spawn.x).toBeGreaterThanOrEqual(room.x)
    expect(map.spawn.x).toBeLessThan(room.x + room.w)
    expect(map.spawn.y).toBeGreaterThanOrEqual(room.y)
    expect(map.spawn.y).toBeLessThan(room.y + room.h)
  })

  it('places four portals on their slots, in spec order, with unique kinds', () => {
    expect(map.portals).toHaveLength(4)
    expect(map.portals.map((p) => p.kind)).toEqual(['storybook', 'quiz', 'explain', 'sealed'])
    expect(new Set(map.portals.map((p) => p.kind)).size).toBe(4)
    expect(map.portals.map((p) => p.at)).toEqual([
      { x: 7, y: 7 },
      { x: 17, y: 5 },
      { x: 27, y: 7 },
      { x: 17, y: 17 },
    ])
    expect(map.portals.map((p) => p.label)).toEqual(SPECS.map((s) => s.label))
    expect(map.portals.map((p) => p.blurb)).toEqual(SPECS.map((s) => s.blurb))
    expect(map.portals.map((p) => p.locked)).toEqual([false, false, false, true])
  })

  it('gives every portal a 3x2 hotspot anchored one tile to its left', () => {
    for (const portal of map.portals) {
      expect(portal.hotspot).toEqual({ x: portal.at.x - 1, y: portal.at.y, w: 3, h: 2 })
    }
  })

  it('stands every portal anchor and every hotspot tile on floor', () => {
    for (const portal of map.portals) {
      expect(tileAt(map, portal.at.x, portal.at.y)).toBe(FLOOR)
      for (const tile of rectTiles(portal.hotspot)) {
        expect(tileAt(map, tile.x, tile.y)).toBe(FLOOR)
      }
    }
  })

  it('reaches every hotspot tile of every portal by walking from spawn', () => {
    // The one test that would catch a portal walled off by a layout change.
    // Locked portals are included on purpose: locked is a content rule, not a
    // map rule, so the player must still be able to stand in front of one.
    const reachable = flood(map, map.spawn)
    for (const portal of map.portals) {
      for (const tile of rectTiles(portal.hotspot)) {
        expect(reachable.has(key(tile))).toBe(true)
      }
    }
  })

  it('keeps hotspots disjoint and clear of the spawn tile', () => {
    const seen = new Set<string>()
    for (const portal of map.portals) {
      for (const tile of rectTiles(portal.hotspot)) {
        expect(seen.has(key(tile))).toBe(false)
        seen.add(key(tile))
      }
    }
    expect(seen.has(key(map.spawn))).toBe(false)
  })

  it('scatters decor on floor only, off the hotspots, the spawn pad and the paths', () => {
    // The radiating stone paths are negative space in this scatter, not tiles.
    const blocked = new Set<string>()
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) blocked.add(key({ x: map.spawn.x + dx, y: map.spawn.y + dy }))
    }
    for (const portal of map.portals) {
      for (const tile of rectTiles(portal.hotspot)) blocked.add(key(tile))
      for (const tile of pathLine(map.spawn, portal.at)) blocked.add(key(tile))
    }

    expect(map.decor.length).toBeGreaterThan(0)
    for (const placement of map.decor) {
      expect(tileAt(map, placement.at.x, placement.at.y)).toBe(FLOOR)
      expect(blocked.has(key(placement.at))).toBe(false)
    }
    expect(new Set(map.decor.map((d) => key(d.at))).size).toBe(map.decor.length)
  })

  it('mirrors the seed and title it was built from', () => {
    expect(map.gameId).toBe('world0001')
    expect(map.title).toBe('Overfitting and Generalisation')
  })

  it('is deterministic for identical input', () => {
    const again = buildHub(input())
    expect(Array.from(again.tiles)).toEqual(Array.from(map.tiles))
    expect(again.portals).toEqual(map.portals)
    expect(again.decor).toEqual(map.decor)
    expect(again.spawn).toEqual(map.spawn)
    expect(again.rooms).toEqual(map.rooms)
  })

  it('changes only the decor when the seed changes', () => {
    const other = buildHub(input({ seed: 'world0002' }))
    expect(Array.from(other.tiles)).toEqual(Array.from(map.tiles))
    expect(other.portals).toEqual(map.portals)
    expect(other.spawn).toEqual(map.spawn)
    expect(other.decor).not.toEqual(map.decor)
  })
})

describe('buildHub with an incomplete portal list', () => {
  const partial = (count: number): WorldMap =>
    buildHub(input({ portals: SPECS.slice(0, count) }))

  it('survives fewer than four specs', () => {
    for (const count of [1, 2, 3]) {
      const map = partial(count)
      expect(map.portals).toHaveLength(count)
      expect(map.portals.map((p) => p.kind)).toEqual(
        SPECS.slice(0, count).map((s) => s.kind as PortalKind),
      )
      const reachable = flood(map, map.spawn)
      for (const portal of map.portals) {
        for (const tile of rectTiles(portal.hotspot)) expect(reachable.has(key(tile))).toBe(true)
      }
    }
  })

  it('survives an empty spec list', () => {
    const map = partial(0)
    expect(map.portals).toEqual([])
    expect(map.rooms).toHaveLength(1)
    expect(map.tiles).toHaveLength(map.width * map.height)
    expect(tileAt(map, map.spawn.x, map.spawn.y)).toBe(FLOOR)
  })

  it('ignores specs beyond the fourth slot rather than stacking them', () => {
    const map = buildHub(input({ portals: [...SPECS, ...SPECS] }))
    expect(map.portals).toHaveLength(4)
  })
})

describe('pathLine', () => {
  it('starts at the source, ends at the target and never skips a tile', () => {
    const line = pathLine({ x: 17, y: 11 }, { x: 7, y: 7 })
    expect(line[0]).toEqual({ x: 17, y: 11 })
    expect(line[line.length - 1]).toEqual({ x: 7, y: 7 })
    for (let i = 1; i < line.length; i++) {
      const dx = Math.abs(line[i].x - line[i - 1].x)
      const dy = Math.abs(line[i].y - line[i - 1].y)
      expect(Math.max(dx, dy)).toBe(1)
    }
  })

  it('returns the single tile when source and target coincide', () => {
    expect(pathLine({ x: 3, y: 4 }, { x: 3, y: 4 })).toEqual([{ x: 3, y: 4 }])
  })
})
