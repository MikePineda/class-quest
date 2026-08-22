/**
 * The visual vocabulary: the one place that maps a content enum to real pixels.
 *
 * `schema/game.schema.json` closes `background`, `actor` and `prop` to fixed
 * enums precisely so the model never emits CSS, colour or layout — it names a
 * thing from a hand-built vocabulary and the client decides what that looks
 * like. This module is that decision, and it is the only file that changes when
 * new art lands.
 *
 * **Exhaustiveness is the point of the module.** The three tables are typed as
 * `Record<Enum, ...>`, so adding a value to the schema fails to COMPILE until
 * someone declares its art here. A new enum value silently rendering as nothing
 * is the failure mode this prevents. There are no fallbacks: the sprite pack
 * covers all six backgrounds, all four actors and all six props.
 *
 * Every `src` is a file that already exists under `frontend/public/sprites/`,
 * sliced offline by `scripts/slice_sprites.py`; `public/sprites/manifest.json`
 * is the source of truth for the pixel sizes declared below, and the tests
 * check both the sizes and that each file is on disk.
 */

import type { Actor, Background, Prop } from '../api/types'
import type { ActorArt, ActorArts, Anim, Biome, Biomes, PropArt, PropArts, Still } from './types'

/** Terrain and decor are authored at 16px wide; only the tall pieces differ in height. */
const still = (src: string, w: number, h: number): Still => ({ src, w, h })

const tile = (name: string): Still => still(`/sprites/tiles/${name}.png`, 16, 16)
const decor = (name: string, h: number): Still => still(`/sprites/decor/${name}.png`, 16, h)
const propSprite = (name: string, w: number, h: number): PropArt => ({
  kind: 'sprite',
  sprite: still(`/sprites/props/${name}.png`, w, h),
})

/** Idle sheets are 32px frames, run sheets 64px: the run pose needs the extra headroom. */
const idle = (name: string, frames: number, fps = 6): Anim => ({
  src: `/sprites/actors/${name}_idle.png`,
  frame: 32,
  frames,
  fps,
})
const run = (name: string, frames: number, fps = 10): Anim => ({
  src: `/sprites/actors/${name}_run.png`,
  frame: 64,
  frames,
  fps,
})

/**
 * Six biomes, six backgrounds. Each picks a floor, a matching wall pair and a
 * little decor; `tint` is a low-alpha wash washed over the room so chapters
 * read as different places without fighting the app's dark palette
 * (background `#0b1326`, amber `#f59e0b`, teal `#4fdbc8`).
 */
export const BIOMES: Biomes = {
  cavern: {
    floor: tile('floor_brick'),
    wallTop: tile('wall_stone_top'),
    wallFace: tile('wall_stone_face'),
    // The crystals live under props/ but read as scenery when scattered loose.
    decor: [decor('rock', 16), still('/sprites/props/crystal_cluster.png', 16, 16)],
    tint: 'rgba(38, 70, 130, 0.30)',
  },
  forest_path: {
    floor: tile('floor_grass'),
    wallTop: tile('wall_tan_top'),
    wallFace: tile('wall_tan_face'),
    decor: [decor('rock', 16)],
    tint: 'rgba(66, 160, 110, 0.18)',
  },
  ruins: {
    floor: tile('floor_sand'),
    wallTop: tile('wall_stone_top'),
    wallFace: tile('wall_stone_face'),
    decor: [decor('rock', 16), decor('banner', 32)],
    tint: 'rgba(160, 142, 122, 0.16)',
  },
  observatory: {
    floor: tile('floor_brick'),
    wallTop: tile('wall_stone_top'),
    wallFace: tile('wall_stone_face'),
    decor: [decor('bookshelf', 32)],
    tint: 'rgba(76, 66, 156, 0.30)',
  },
  shore: {
    floor: tile('floor_sand'),
    wallTop: tile('wall_tan_top'),
    wallFace: tile('wall_tan_face'),
    decor: [decor('rock', 16)],
    tint: 'rgba(255, 193, 116, 0.16)',
  },
  village: {
    floor: tile('floor_dirt'),
    wallTop: tile('wall_brown_top'),
    wallFace: tile('wall_brown_face'),
    decor: [decor('banner', 32)],
    tint: 'rgba(245, 158, 11, 0.14)',
  },
}

/**
 * Frame counts come straight from the manifest. `mentor_owl` is the mascot: it
 * is drawn in-house, stands at the scene it narrates and never walks, so it has
 * a single idle frame and no `run` sheet at all.
 */
export const ACTORS: ActorArts = {
  explorer: { idle: idle('explorer', 4), run: run('explorer', 6) },
  rival: { idle: idle('rival', 4), run: run('rival', 6) },
  villager: { idle: idle('villager', 4), run: run('villager', 6) },
  // One frame, so the fps is inert — kept at 1 rather than faking a cadence.
  mentor_owl: { idle: idle('mentor_owl', 1, 1) },
}

/**
 * Props are blitted sprites, with one exception: `chart_frame` frames a real
 * plotted curve the learner reads off, so it must stay crisp at any zoom and is
 * drawn in code instead.
 */
export const PROPS: PropArts = {
  doorway_pair: propSprite('doorway_pair', 32, 32),
  lantern: propSprite('lantern', 16, 32),
  chest: propSprite('chest', 32, 32),
  crystal_cluster: propSprite('crystal_cluster', 16, 16),
  signpost: propSprite('signpost', 32, 32),
  chart_frame: { kind: 'component', component: 'chart_frame' },
}

// Total by construction: the tables are exhaustive, so these never miss.
export function biomeFor(b: Background): Biome {
  return BIOMES[b]
}

export function actorArt(a: Actor): ActorArt {
  return ACTORS[a]
}

export function propArt(p: Prop): PropArt {
  return PROPS[p]
}
