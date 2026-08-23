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
import type { ActorArt, ActorArts, Anim, Biome, Biomes, PortalKind, PropArt, PropArts, Still } from './types'

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

// --- the player's kit -------------------------------------------------------
//
// Deliberately NOT part of the `actor` enum, and not a `prop`. What the hero
// carries is a client-side idea about the hero; `schema/game.schema.json` is
// the law and has nothing to say about it, exactly as it has nothing to say
// about portals.
//
// The explorer sheet is drawn empty-handed: the pack ships hands and weapons
// as separate layers to be composited per animation frame, and we do not have
// the rig offsets that would place them. At 16px that reads as a hero with no
// hands at all, which is what this fixes.
//
// One still, anchored to the bottom centre of the actor's frame -- the one
// point the 32px idle sheet and the 64px run sheet agree on, so it rides every
// frame of both. `GEAR_OFFSET` is measured from that anchor: `x` is the left
// edge of the sword relative to the frame's centre, `y` how far its bottom
// sits above the actor's feet. Mirrored with the actor when it faces left.

export interface PlayerGear {
  sprite: Still
  offset: { x: number; y: number }
}

export const PLAYER_GEAR: PlayerGear = {
  sprite: still('/sprites/gear/short_sword.png', 16, 16),
  // Carried, not slung: the blade rides up past the shoulder with the guard at
  // rib height, on the far side of the body from its centre. The body spans
  // -9..+9 either side of the anchor and this lands the blade at +6..+11, which
  // is the part that matters -- under about +5 it crosses the midline and hangs
  // between his legs, which is where it used to be. `y` is what picks the
  // carry: drop it toward 2 and the sword slides down his leg to the ankle.
  offset: { x: 1, y: 9 },
}

// --- portals ----------------------------------------------------------------
// Deliberately NOT part of the `Prop` enum. A portal is a client-side idea about
// how a world is navigated; `schema/game.schema.json` is the law and has no
// business knowing about it. Keeping this table separate also means it carries
// colours, which the schema would never model.
//
// The art is composited: a real sprite for the masonry, light drawn in code.
// The sprite pack contains nothing emissive and no coloured variants, so there
// is nothing to cut for a glow — and code-drawn light gives colour and
// animation as parameters. `chart_frame` already set this precedent.
//
// The frame is `portal_arch.png`, a tall stone archway whose interior is a
// solid black hole. That hollow is the point: it is the canvas the vortex is
// painted onto, so the stone reads as masonry around a gap rather than as a
// door. `doorway_pair.png` — literally two closed wooden leaves — read as a
// door no matter how much light was poured through it, which is why it is gone.

export interface PortalArt {
  /** Real pixel art under the glow: the stone arch, hollow in the middle. */
  frame: Still
  /** Flanking light source, or null for a portal that gives off none. */
  lantern: Still | null
  /** Hot centre of the vortex, and the darker of its two alternating bands. */
  core: string
  /** Ground pool. Low alpha; drawn with `lighter`. */
  glow: string
  /**
   * One-pixel outline, and the lighter of the vortex's two alternating bands.
   * Load-bearing: it is the edge that survives the biome tint multiply.
   */
  rim: string
  /** An 8x8 geometric glyph bobbing above the arch. Drawn, never typeset. */
  icon: 'book' | 'question' | 'speech' | 'lock'
}

const arch: Still = { src: '/sprites/props/portal_arch.png', w: 32, h: 48 }
const lantern: Still = { src: '/sprites/props/lantern.png', w: 16, h: 32 }

export const PORTALS: Record<PortalKind, PortalArt> = {
  // Amber is the app's primary, so the reading gate feels like home.
  storybook: { frame: arch, lantern, core: '#f0a63c', glow: 'rgba(240,166,60,0.50)', rim: '#ffc174', icon: 'book' },
  quiz: { frame: arch, lantern, core: '#ff8f86', glow: 'rgba(255,143,134,0.50)', rim: '#ffb9b3', icon: 'question' },
  // Teal is the app's secondary and reads as the calmest of the three, which
  // suits the gate where you talk rather than answer.
  explain: { frame: arch, lantern, core: '#43d9c4', glow: 'rgba(67,217,196,0.50)', rim: '#8ef0e2', icon: 'speech' },
  sealed: { frame: arch, lantern: null, core: '#6f7aa0', glow: 'rgba(111,122,160,0.30)', rim: '#8f9ac0', icon: 'lock' },
}

export function portalArt(kind: PortalKind): PortalArt {
  return PORTALS[kind]
}
