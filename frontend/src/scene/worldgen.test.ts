import { describe, expect, it } from 'vitest'

import type { Game, Scene } from '../api/types'
import { fixtureGauntlet, fixtureQuest } from '../fixtures'
import { FLOOR, VOID, WALL, tileAt } from './types'
import type { Point, WorldMap } from './types'
import { buildWorld } from './worldgen'

const games: Array<[string, Game]> = [
  ['quest', fixtureQuest],
  ['gauntlet', fixtureGauntlet],
]

/** A one-chapter, one-scene game: the smallest thing the generator must survive. */
const tinyGame: Game = {
  schema_version: '1.0',
  game_id: 'tiny0001',
  graph_id: 'graph001',
  archetype: 'quest',
  title: 'Tiny',
  chapters: [
    {
      id: 'ch_only',
      title: 'The only chapter',
      concept_ids: ['c1'],
      background: 'forest_path',
      scenes: [
        { type: 'dialogue', id: 'sc_only', speaker: 'villager', lines: ['Hello.'] },
      ],
    },
  ],
}

/** A chapter carrying the schema maximum of 8 scenes. */
const maxScenesGame: Game = {
  schema_version: '1.0',
  game_id: 'maxi0001',
  graph_id: 'graph001',
  archetype: 'gauntlet',
  title: 'Eight',
  chapters: [
    {
      id: 'ch_eight',
      title: 'Eight scenes',
      concept_ids: ['c1'],
      background: 'ruins',
      scenes: Array.from({ length: 8 }, (_, i): Scene => ({
        type: 'dialogue',
        id: `sc_${i}`,
        speaker: 'explorer',
        lines: [`Line ${i}`],
      })),
    },
  ],
}

const allScenes = (game: Game): Scene[] => game.chapters.flatMap((c) => c.scenes)

const key = (p: Point): string => `${p.x},${p.y}`

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

describe.each(games)('buildWorld(%s fixture)', (_name, game) => {
  const map = buildWorld(game)

  it('emits exactly one node per scene', () => {
    const scenes = allScenes(game)
    expect(map.nodes).toHaveLength(scenes.length)
    expect(map.nodes.map((n) => n.sceneId)).toEqual(scenes.map((s) => s.id))
    expect(new Set(map.nodes.map((n) => n.sceneId)).size).toBe(scenes.length)
  })

  it('numbers node order 0..n-1 in chapter-then-scene play order', () => {
    expect(map.nodes.map((n) => n.order)).toEqual(map.nodes.map((_, i) => i))
    const expectedChapters = game.chapters.flatMap((c) => c.scenes.map(() => c.id))
    expect(map.nodes.map((n) => n.chapterId)).toEqual(expectedChapters)
  })

  it('gives dialogue scenes their speaker and everything else the mascot', () => {
    for (const node of map.nodes) {
      const expected = node.scene.type === 'dialogue' ? node.scene.speaker : 'mentor_owl'
      expect(node.actor).toBe(expected)
    }
  })

  it('places every node on a floor tile', () => {
    for (const node of map.nodes) {
      expect(tileAt(map, node.at.x, node.at.y)).toBe(FLOOR)
    }
  })

  it('spawns on a floor tile that is not a node tile', () => {
    expect(tileAt(map, map.spawn.x, map.spawn.y)).toBe(FLOOR)
    expect(map.nodes.some((n) => n.at.x === map.spawn.x && n.at.y === map.spawn.y)).toBe(false)
  })

  it('builds one room per chapter, in order, without overlapping interiors', () => {
    expect(map.rooms.map((r) => r.chapterId)).toEqual(game.chapters.map((c) => c.id))
    expect(map.rooms.map((r) => r.background)).toEqual(game.chapters.map((c) => c.background))
    for (let i = 0; i < map.rooms.length; i++) {
      for (let j = i + 1; j < map.rooms.length; j++) {
        const a = map.rooms[i]
        const b = map.rooms[j]
        const overlaps =
          a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
        expect(overlaps).toBe(false)
      }
    }
  })

  it('keeps every room interior on floor and inside the map', () => {
    for (const room of map.rooms) {
      expect(room.x).toBeGreaterThan(0)
      expect(room.y).toBeGreaterThan(0)
      expect(room.x + room.w).toBeLessThan(map.width)
      expect(room.y + room.h).toBeLessThan(map.height)
      for (let y = room.y; y < room.y + room.h; y++) {
        for (let x = room.x; x < room.x + room.w; x++) {
          expect(tileAt(map, x, y)).toBe(FLOOR)
        }
      }
    }
  })

  it('reaches every node from the spawn by walking floor tiles', () => {
    const reachable = flood(map, map.spawn)
    for (const node of map.nodes) {
      expect(reachable.has(key(node.at))).toBe(true)
    }
  })

  it('holds only void, wall and floor tiles, width * height of them', () => {
    expect(map.tiles).toHaveLength(map.width * map.height)
    for (const tile of map.tiles) {
      expect([VOID, FLOOR, WALL]).toContain(tile)
    }
  })

  it('never puts decor on a node tile or on the spawn', () => {
    const blocked = new Set(map.nodes.map((n) => key(n.at)))
    blocked.add(key(map.spawn))
    for (const decor of map.decor) {
      expect(blocked.has(key(decor.at))).toBe(false)
      expect(tileAt(map, decor.at.x, decor.at.y)).toBe(FLOOR)
    }
  })

  it('keeps decor inside room interiors, never in a corridor', () => {
    for (const decor of map.decor) {
      const inRoom = map.rooms.some(
        (r) =>
          decor.at.x >= r.x && decor.at.x < r.x + r.w && decor.at.y >= r.y && decor.at.y < r.y + r.h,
      )
      expect(inRoom).toBe(true)
    }
  })

  it('is deterministic', () => {
    const again = buildWorld(game)
    expect(again.width).toBe(map.width)
    expect(again.height).toBe(map.height)
    expect(Array.from(again.tiles)).toEqual(Array.from(map.tiles))
    expect(again.rooms).toEqual(map.rooms)
    expect(again.nodes).toEqual(map.nodes)
    expect(again.decor).toEqual(map.decor)
    expect(again.spawn).toEqual(map.spawn)
  })

  it('mirrors the game it was built from', () => {
    expect(map.gameId).toBe(game.game_id)
    expect(map.title).toBe(game.title)
  })
})

describe('buildWorld edge cases', () => {
  it('handles a single-chapter, single-scene game', () => {
    const map = buildWorld(tinyGame)
    expect(map.rooms).toHaveLength(1)
    expect(map.nodes).toHaveLength(1)
    expect(map.nodes[0].order).toBe(0)
    expect(map.nodes[0].actor).toBe('villager')
    expect(tileAt(map, map.nodes[0].at.x, map.nodes[0].at.y)).toBe(FLOOR)
    expect(tileAt(map, map.spawn.x, map.spawn.y)).toBe(FLOOR)
    expect(flood(map, map.spawn).has(key(map.nodes[0].at))).toBe(true)
    expect(map.tiles).toHaveLength(map.width * map.height)
  })

  it('handles a chapter with the maximum eight scenes', () => {
    const map = buildWorld(maxScenesGame)
    expect(map.nodes).toHaveLength(8)
    expect(new Set(map.nodes.map((n) => key(n.at))).size).toBe(8)
    const reachable = flood(map, map.spawn)
    for (const node of map.nodes) {
      expect(reachable.has(key(node.at))).toBe(true)
    }
  })

  it('walls every void tile that touches floor, and leaves the rest void', () => {
    const map = buildWorld(tinyGame)
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

  it('joins consecutive rooms so the whole map is one connected region', () => {
    const map = buildWorld(fixtureQuest)
    const reachable = flood(map, map.spawn)
    let floorCount = 0
    for (const tile of map.tiles) if (tile === FLOOR) floorCount++
    expect(reachable.size).toBe(floorCount)
  })
})
