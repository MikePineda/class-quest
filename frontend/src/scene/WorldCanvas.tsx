/**
 * The renderer: a `WorldMap` drawn to a canvas, with a camera that follows the
 * player.
 *
 * Everything here is deliberately imperative. The world redraws every frame
 * from the player ref, so React renders this component when the *world* changes
 * (a node completed, the viewport resized) and never for a step of movement.
 *
 * Three rules keep the pixel art honest:
 *  - the art is only ever scaled by a whole number, with smoothing off, so a
 *    source pixel is always a square block of screen pixels;
 *  - the camera is rounded to whole source pixels, otherwise tiles shimmer
 *    against each other as it moves;
 *  - a wall tile draws its *face* when the tile below it is floor and its *top*
 *    otherwise, which is the whole trick that makes a top-down room read as
 *    having height.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { guideTileFor } from './hubgen'
import { FLOOR, TILE, WALL, tileAt } from './types'
import type { Anim, Biome, PortalKind, PortalNode, SceneNode, Still, WorldMap } from './types'
import type { PlayerBody } from './usePlayer'
import type { PortalArt } from './vocabulary'
import { actorArt, biomeFor, portalArt, propArt } from './vocabulary'
import { CHART_BOX, drawChartFrame as plotChartFrame } from './vn/chartFrameArt'

/** The learner walks the world as the explorer; the other actors stand at their scenes. */
const PLAYER_ACTOR = 'explorer'

/** Roughly how many tiles we want across the viewport before picking the integer scale. */
const TARGET_TILES_ACROSS = 26
const TARGET_TILES_DOWN = 15
const MIN_SCALE = 2
const MAX_SCALE = 6

/** Where props stand relative to the actor they belong to, in tiles. */
const PROP_OFFSETS = [
  { x: -1, y: 0 },
  { x: 1, y: 0 },
  { x: -2, y: 0 },
  { x: 2, y: 0 },
  { x: 0, y: -1 },
]

/**
 * `portal_arch.png` is a 32x48 stone archway with a single hollow opening — one
 * gate, one hole, not the two leaves `doorway_pair.png` had. Everything below is
 * read off the file's own pixels rather than guessed:
 *
 *  - the masonry occupies rows 2..45, so dropping the sprite by 2 puts the feet
 *    of the pillars exactly on the tile's foot line and leaves the two rows of
 *    base shadow below it;
 *  - the hollow is the span enclosed by the innermost masonry on each row. It is
 *    columns 4..27 from row 7 down to row 45 — 24 wide, an arch whose head is a
 *    half-circle of radius 12 springing from row 27 (checked against the art:
 *    the curve is 20px wide at row 12 and 24px wide at row 17, which is what a
 *    radius-12 semicircle gives to within half a pixel).
 */
const GATE_DROP = 2
/** The hollow, in source pixels relative to the tile's foot line. */
const GATE_OPENING = { w: 24, top: -39, bottom: 0 }
/**
 * `portal_arch.png` is an *opaque* slice of the tileset: the black outside the
 * arch is as solid as the black inside it, so blitting the file whole punches a
 * 32x48 rectangle out of the floor. These are the columns the masonry really
 * occupies on each row of the head — read off the same pixels — and the clip
 * built from them keeps the slab to the shape of the arch. The hollow stays
 * black on purpose: it is the hole the vortex is painted into.
 */
const ARCH_HEAD: ReadonlyArray<readonly [row: number, from: number, to: number]> = [
  [2, 11, 21],
  [3, 9, 23],
  [4, 7, 25],
  [5, 6, 26],
  [6, 5, 27],
  [7, 4, 28],
  [8, 3, 29],
  [9, 2, 30],
  [10, 2, 30],
]
/** Below the head the arch is the full width of the sprite, down to the foot line. */
const ARCH_BODY = { top: 11, bottom: 46 }
/**
 * Lantern centres. The plan says `at.x - 1` and `at.x + 2`, which flanks a gate
 * drawn from the tile's left edge; the art is drawn *centred* on the tile, so
 * the same flank is a tile and a half either side of centre.
 */
const GATE_LANTERNS = [-TILE * 1.5, TILE * 1.5]
/** A locked gate keeps its shape but loses its colour. */
const LOCKED_RIM = '#9aa1ad'

// --- the vortex ------------------------------------------------------------
// Nested oval arcs around a hot centre, each one turning at its own rate and
// swinging around the middle by its own amount. The differential is the whole
// trick: rings turning in lockstep read as a target, rings turning faster the
// closer they get to the middle read as something being pulled down a hole.

/** Centre of the swirl, in source pixels relative to the foot line. */
const VORTEX_CENTRE_Y = -21
/** How many rings. Five is enough to read as depth and cheap enough to redraw. */
const VORTEX_RINGS = 5
/** Widest ring, in source pixels. Two short of the hollow so it never kisses stone. */
const VORTEX_RADIUS = 10
/** Rings are taller than wide: the hollow is an arch, not a porthole. */
const VORTEX_SQUASH = 1.5
/** Flakes orbiting outside the rings. Positions come from the index, never a PRNG. */
const VORTEX_FLAKES = 7
/** The golden angle, so the flakes never clump however many there are. */
const FLAKE_SPREAD = 2.399963

/**
 * Scene-node completion is dead on a hub map (`nodes: []`), and the props now
 * carry portal kinds rather than scene ids. Legacy chapter maps therefore draw
 * every marker as unvisited until the node path is deleted after the demo.
 */
const NO_COMPLETED_SCENES: ReadonlySet<string> = new Set<string>()

export interface WorldCanvasProps {
  map: WorldMap
  /** Live player state, read once per frame. */
  player: RefObject<PlayerBody>
  /** Modes of learning the player has finished. */
  cleared: ReadonlySet<PortalKind>
  /** The gate the player is standing at, lit harder than the rest. */
  activePortal: PortalKind | null
}

/**
 * Re-alpha a colour from the portal table. Gradients have to fade to the *same*
 * hue at zero alpha: canvas interpolates colour stops un-premultiplied, so a
 * fade to `transparent` runs through black and turns amber light into mud.
 */
function withAlpha(colour: string, alpha: number): string {
  const hex = /^#([0-9a-f]{6})$/i.exec(colour.trim())
  if (hex) {
    const packed = Number.parseInt(hex[1], 16)
    return `rgba(${(packed >> 16) & 255}, ${(packed >> 8) & 255}, ${packed & 255}, ${alpha})`
  }
  const rgb = /^rgba?\(([^)]+)\)$/i.exec(colour.trim())
  if (rgb) {
    const parts = rgb[1].split(',').map((part) => Number.parseFloat(part))
    return `rgba(${parts[0]}, ${parts[1]}, ${parts[2]}, ${alpha})`
  }
  return colour
}

// --- image preloading ------------------------------------------------------

/** Resolves even when an image 404s: a missing sprite is a hole in the art, not a blank screen. */
function loadImage(src: string): Promise<[string, HTMLImageElement | null]> {
  return new Promise((resolve) => {
    const image = new Image()
    image.onload = () => resolve([src, image])
    image.onerror = () => resolve([src, null])
    image.src = src
  })
}

function sourcesFor(map: WorldMap): string[] {
  const sources = new Set<string>()

  const playerArt = actorArt(PLAYER_ACTOR)
  sources.add(playerArt.idle.src)
  if (playerArt.run) sources.add(playerArt.run.src)

  for (const room of map.rooms) {
    const biome = biomeFor(room.background)
    sources.add(biome.floor.src)
    sources.add(biome.wallTop.src)
    sources.add(biome.wallFace.src)
    for (const decor of biome.decor) sources.add(decor.src)
  }

  for (const node of map.nodes) {
    sources.add(actorArt(node.actor).idle.src)
    for (const prop of node.props) {
      const art = propArt(prop)
      if (art.kind === 'sprite') sources.add(art.sprite.src)
    }
  }

  // Never cut this loop: without it the gates are missing images and the hub
  // reads as broken rather than unfinished. The guide beside a gate is loaded
  // here too — it is not a `SceneNode`, so the node loop above never sees it.
  for (const portal of map.portals) {
    const art = portalArt(portal.kind)
    sources.add(art.frame.src)
    if (art.lantern) sources.add(art.lantern.src)
    if (portal.guide) sources.add(actorArt(portal.guide).idle.src)
  }

  return [...sources]
}

// --- geometry --------------------------------------------------------------

/**
 * Which room owns each tile, so a tile knows which biome to draw itself with.
 * Rooms claim their rect plus the wall ring around it; anything left over
 * (corridors between rooms) goes to the nearest room so the ground never breaks.
 */
function buildRoomIndex(map: WorldMap): Int16Array {
  const index = new Int16Array(map.width * map.height).fill(-1)

  map.rooms.forEach((room, i) => {
    for (let y = room.y - 1; y <= room.y + room.h; y += 1) {
      if (y < 0 || y >= map.height) continue
      for (let x = room.x - 1; x <= room.x + room.w; x += 1) {
        if (x < 0 || x >= map.width) continue
        index[y * map.width + x] = i
      }
    }
  })

  if (map.rooms.length === 0) return index

  const centres = map.rooms.map((room) => ({ x: room.x + room.w / 2, y: room.y + room.h / 2 }))
  for (let y = 0; y < map.height; y += 1) {
    for (let x = 0; x < map.width; x += 1) {
      const at = y * map.width + x
      if (index[at] !== -1) continue
      let best = 0
      let bestDistance = Infinity
      centres.forEach((centre, i) => {
        const distance = (centre.x - x) ** 2 + (centre.y - y) ** 2
        if (distance < bestDistance) {
          bestDistance = distance
          best = i
        }
      })
      index[at] = best
    }
  }

  return index
}

const clampCamera = (value: number, view: number, world: number): number =>
  world <= view ? (world - view) / 2 : Math.min(Math.max(value, 0), world - view)

/**
 * The integer zoom. Start from how many tiles we want on screen, then zoom in
 * far enough that the map covers the viewport if it can: a short map letterboxed
 * against black reads as a bug, not as a camera clamp.
 */
function pickScale(width: number, height: number, map: WorldMap): number {
  const preferred = Math.floor(
    Math.min(width / (TILE * TARGET_TILES_ACROSS), height / (TILE * TARGET_TILES_DOWN)),
  )
  const cover = Math.ceil(
    Math.max(width / (map.width * TILE), height / (map.height * TILE)),
  )
  const scale = Math.max(preferred || MIN_SCALE, cover)
  return Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale))
}

/**
 * `DecorPlacement.sprite` keys into the biome's decor list. Accept both an index
 * and a sprite path so the two modules cannot disagree about the encoding.
 */
function resolveDecor(biome: Biome, key: string): Still | null {
  if (biome.decor.length === 0) return null
  const asIndex = Number.parseInt(key, 10)
  if (Number.isInteger(asIndex) && String(asIndex) === key.trim()) {
    return biome.decor[asIndex] ?? null
  }
  return biome.decor.find((still) => still.src === key || still.src.includes(key)) ?? null
}

// --- component -------------------------------------------------------------

export function WorldCanvas({ map, player, cleared, activePortal }: WorldCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  // Keyed by the map it was loaded for, so a new map reads as "not ready yet"
  // during render instead of needing a synchronous reset in an effect.
  const [loaded, setLoaded] = useState<{ map: WorldMap; cache: Map<string, HTMLImageElement> } | null>(null)
  const images = loaded?.map === map ? loaded.cache : null

  const roomIndex = useMemo(() => buildRoomIndex(map), [map])
  const biomes = useMemo(() => map.rooms.map((room) => biomeFor(room.background)), [map])
  // Frame-local inputs the loop must see without being torn down and rebuilt.
  const clearedRef = useRef(cleared)
  const activeRef = useRef(activePortal)
  useEffect(() => {
    clearedRef.current = cleared
    activeRef.current = activePortal
  }, [cleared, activePortal])

  // Preload every sprite before the first paint: a world that pops in tile by
  // tile on stage looks broken even though it is only slow.
  useEffect(() => {
    let cancelled = false
    Promise.all(sourcesFor(map).map(loadImage)).then((results) => {
      if (cancelled) return
      const cache = new Map<string, HTMLImageElement>()
      for (const [src, image] of results) if (image) cache.set(src, image)
      setLoaded({ map, cache })
    })
    return () => {
      cancelled = true
    }
  }, [map])

  useEffect(() => {
    const canvas = canvasRef.current
    const wrapper = wrapperRef.current
    if (!canvas || !wrapper || !images) return

    const context = canvas.getContext('2d')
    if (!context) return
    const ctx = context

    const view = { width: 0, height: 0, scale: MIN_SCALE }

    const resize = () => {
      const rect = wrapper.getBoundingClientRect()
      const width = Math.max(1, Math.floor(rect.width))
      const height = Math.max(1, Math.floor(rect.height))
      view.width = width
      view.height = height
      view.scale = pickScale(width, height, map)
      // The backing store stays in CSS pixels; `image-rendering: pixelated`
      // handles the device-pixel-ratio step, which is itself a whole number.
      canvas.width = width
      canvas.height = height
    }

    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(wrapper)

    const image = (src: string) => images.get(src) ?? null

    const drawStill = (still: Still, centreX: number, footY: number) => {
      const sprite = image(still.src)
      if (!sprite) return
      ctx.drawImage(sprite, Math.round(centreX - still.w / 2), Math.round(footY - still.h), still.w, still.h)
    }

    const drawAnim = (anim: Anim, centreX: number, footY: number, seconds: number, flip: boolean) => {
      const sprite = image(anim.src)
      if (!sprite) return
      const frames = Math.max(1, anim.frames)
      const index = frames === 1 ? 0 : Math.floor(seconds * anim.fps) % frames
      const size = anim.frame
      const dx = Math.round(centreX - size / 2)
      const dy = Math.round(footY - size)
      if (flip) {
        ctx.save()
        ctx.translate(dx + size, dy)
        ctx.scale(-1, 1)
        ctx.drawImage(sprite, index * size, 0, size, size, 0, 0, size, size)
        ctx.restore()
        return
      }
      ctx.drawImage(sprite, index * size, 0, size, size, dx, dy, size, size)
    }

    const drawShadow = (centreX: number, footY: number) => {
      ctx.save()
      ctx.fillStyle = 'rgba(0, 0, 0, 0.32)'
      ctx.beginPath()
      ctx.ellipse(centreX, footY - 2, TILE * 0.32, TILE * 0.14, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    }

    /**
     * `chart_frame` is the one prop drawn in code: it frames a real curve —
     * training loss falling while validation loss turns back up — which is the
     * shape the learner is being asked to read.
     *
     * The drawing itself now lives in `vn/chartFrameArt`, so the same curve can be
     * re-plotted at poster size inside a portal instead of only ever existing
     * as a 34x26 box on the floor. This wrapper decides *where* that box goes
     * and nothing else; `vn/chartFrameArt.test.ts` holds the pre-extraction code
     * and asserts the two make identical context calls.
     */
    const drawChartFrame = (centreX: number, footY: number) => {
      plotChartFrame(
        ctx,
        Math.round(centreX - CHART_BOX.w / 2),
        Math.round(footY - CHART_BOX.h - 6),
      )
    }

    const drawMarker = (centreX: number, footY: number, seconds: number, done: boolean, active: boolean) => {
      const pulse = 0.5 + 0.5 * Math.sin(seconds * 2.6)
      ctx.save()
      ctx.lineWidth = 1
      if (done) {
        // Finished: a steady teal ring, no attention-seeking.
        ctx.strokeStyle = 'rgba(79, 219, 200, 0.75)'
        ctx.beginPath()
        ctx.ellipse(centreX, footY - 2, TILE * 0.46, TILE * 0.2, 0, 0, Math.PI * 2)
        ctx.stroke()
        ctx.strokeStyle = '#4fdbc8'
        ctx.lineWidth = 1.5
        ctx.beginPath()
        ctx.moveTo(centreX - 4, footY - 30)
        ctx.lineTo(centreX - 1, footY - 27)
        ctx.lineTo(centreX + 4, footY - 34)
        ctx.stroke()
      } else {
        // Unvisited: an amber ring that breathes, plus a bobbing marker above.
        const radius = TILE * 0.44 + pulse * 2.5
        ctx.strokeStyle = `rgba(245, 158, 11, ${0.35 + pulse * 0.45})`
        ctx.lineWidth = active ? 2 : 1
        ctx.beginPath()
        ctx.ellipse(centreX, footY - 2, radius, radius * 0.42, 0, 0, Math.PI * 2)
        ctx.stroke()
        ctx.fillStyle = `rgba(245, 158, 11, ${0.1 + pulse * 0.12})`
        ctx.fill()

        const bob = Math.sin(seconds * 2.6) * 1.5
        ctx.fillStyle = '#ffc174'
        ctx.beginPath()
        ctx.moveTo(centreX, footY - 32 + bob)
        ctx.lineTo(centreX - 3.5, footY - 37 + bob)
        ctx.lineTo(centreX + 3.5, footY - 37 + bob)
        ctx.closePath()
        ctx.fill()
      }
      ctx.restore()
    }

    /**
     * The arch's silhouette in sprite-local pixels, built once and reused under
     * a translate for every gate on every frame.
     */
    const silhouette = new Path2D()
    for (const [row, from, to] of ARCH_HEAD) silhouette.rect(from, row, to - from, 1)
    silhouette.rect(0, ARCH_BODY.top, 32, ARCH_BODY.bottom - ARCH_BODY.top)

    /** The masonry, blitted through that silhouette so its black corners never land. */
    const drawArchFrame = (still: Still, centreX: number, footY: number) => {
      const sprite = image(still.src)
      if (!sprite) return
      ctx.save()
      ctx.translate(Math.round(centreX - still.w / 2), Math.round(footY + GATE_DROP - still.h))
      ctx.clip(silhouette)
      ctx.drawImage(sprite, 0, 0, still.w, still.h)
      ctx.restore()
    }

    /** The hollow: straight sides, semicircular head. World pixels. */
    const archPath = (centreX: number, footY: number) => {
      const half = GATE_OPENING.w / 2
      const bottom = footY + GATE_OPENING.bottom
      const top = footY + GATE_OPENING.top
      ctx.beginPath()
      ctx.moveTo(centreX - half, bottom)
      ctx.lineTo(centreX - half, top + half)
      ctx.arc(centreX, top + half, half, Math.PI, 0)
      ctx.lineTo(centreX + half, bottom)
      ctx.closePath()
    }

    /**
     * The wash that gives the hollow depth, built once per colour and reused for
     * every gate of that kind on every frame. The stops are authored at the
     * origin and the gradient is painted under a translate, so one object serves
     * them all; the breathing is done with `globalAlpha` rather than by
     * rebuilding colour stops sixty times a second.
     */
    const glows = new Map<string, CanvasGradient>()
    const vortexGlow = (colour: string): CanvasGradient => {
      const cached = glows.get(colour)
      if (cached) return cached
      const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, VORTEX_RADIUS * VORTEX_SQUASH)
      gradient.addColorStop(0, withAlpha(colour, 0.9))
      gradient.addColorStop(0.35, withAlpha(colour, 0.22))
      gradient.addColorStop(1, withAlpha(colour, 0))
      glows.set(colour, gradient)
      return gradient
    }

    /**
     * What is actually behind the stone: a whirlpool of light, clipped to the
     * hollow so nothing spills onto the masonry and composited with `lighter` so
     * it *adds* to the sprite's black interior instead of painting a coloured
     * rectangle over it.
     *
     * Nothing here is random. Every ring and every flake derives its position
     * from its index and the clock, so two runs of the same second draw the same
     * frame and the renderer stays reproducible.
     */
    const drawVortex = (art: PortalArt, centreX: number, footY: number, seconds: number, intensity: number) => {
      ctx.save()
      archPath(centreX, footY)
      ctx.clip()
      ctx.globalCompositeOperation = 'lighter'
      ctx.translate(centreX, footY + VORTEX_CENTRE_Y)

      // 1. Depth. Brightest at the eye, gone by the time it reaches the stone.
      ctx.globalAlpha = 0.55 * intensity
      ctx.fillStyle = vortexGlow(art.core)
      ctx.fillRect(-GATE_OPENING.w, -GATE_OPENING.w, GATE_OPENING.w * 2, GATE_OPENING.w * 2)

      // 2. The rings. Each is an arc, not a closed oval: the gap is what shows
      //    the rotation. Inner rings turn faster and swing further off centre —
      //    that differential is the difference between a vortex and a target.
      ctx.lineCap = 'round'
      for (let i = 0; i < VORTEX_RINGS; i += 1) {
        const t = (i + 1) / VORTEX_RINGS
        const radius = VORTEX_RADIUS * t
        const spin = seconds * (1.6 / t) + i * 0.9
        const drift = (1 - t) * 2.2
        // Alternating bands: the rim colour is the lighter tint of the core.
        ctx.strokeStyle = i % 2 === 0 ? art.rim : art.core
        ctx.lineWidth = i % 2 === 0 ? 1 : 2
        ctx.globalAlpha = intensity * (0.85 - t * 0.4) * (0.75 + 0.25 * Math.sin(seconds * 2.4 + i))
        ctx.beginPath()
        ctx.ellipse(
          Math.cos(spin) * drift,
          Math.sin(spin) * drift * VORTEX_SQUASH,
          radius,
          radius * VORTEX_SQUASH,
          0,
          spin,
          spin + Math.PI * 1.45,
        )
        ctx.stroke()
      }

      // 3. The eye: small, hot, breathing.
      const eye = 1.5 + 0.7 * (0.5 + 0.5 * Math.sin(seconds * 1.8))
      ctx.globalAlpha = intensity
      ctx.fillStyle = art.rim
      ctx.beginPath()
      ctx.ellipse(0, 0, eye, eye * 1.25, 0, 0, Math.PI * 2)
      ctx.fill()

      // 4. Flakes torn off the outside of the rings. Whole pixels, so they stay
      //    square blocks at any zoom instead of blurring into grey.
      ctx.fillStyle = art.rim
      for (let i = 0; i < VORTEX_FLAKES; i += 1) {
        const spin = seconds * (0.85 + (i % 3) * 0.22) + i * FLAKE_SPREAD
        const orbit = VORTEX_RADIUS + 0.8 + (i % 3) * 0.5 + Math.sin(seconds * 1.7 + i) * 0.8
        ctx.globalAlpha = intensity * (0.3 + 0.45 * (0.5 + 0.5 * Math.sin(seconds * 2.6 + i * 1.7)))
        ctx.fillRect(
          Math.round(Math.cos(spin) * orbit),
          Math.round(Math.sin(spin) * orbit * VORTEX_SQUASH),
          i % 3 === 0 ? 2 : 1,
          i % 3 === 0 ? 2 : 1,
        )
      }

      ctx.restore()
    }

    /**
     * The 8x8 glyph that says what is behind a gate. Geometry, never `fillText`:
     * type aliases into mush at 1x source pixels with smoothing off, and the
     * label the learner actually reads lives in the DOM prompt anyway.
     */
    const drawGlyph = (icon: PortalArt['icon'], cx: number, cy: number, colour: string) => {
      ctx.save()
      ctx.fillStyle = colour
      ctx.strokeStyle = colour
      ctx.lineWidth = 1

      if (icon === 'book') {
        // Three stacked lines with a spine down the middle.
        for (const dy of [-3, 0, 3]) ctx.fillRect(cx - 4, cy + dy, 8, 1)
        ctx.fillRect(cx - 0.5, cy - 4, 1, 8)
      } else if (icon === 'question') {
        // Two chevrons over a dot.
        for (const dy of [0, 3]) {
          ctx.beginPath()
          ctx.moveTo(cx - 3, cy - 1 + dy)
          ctx.lineTo(cx, cy - 4 + dy)
          ctx.lineTo(cx + 3, cy - 1 + dy)
          ctx.stroke()
        }
        ctx.fillRect(cx - 1, cy + 3, 2, 2)
      } else if (icon === 'speech') {
        // Two overlapping bubbles: a conversation, not a monologue.
        for (const bubble of [
          { x: cx - 4, y: cy - 4, w: 7, h: 5 },
          { x: cx - 1, y: cy - 1, w: 5, h: 4 },
        ]) {
          ctx.beginPath()
          if (typeof ctx.roundRect === 'function') ctx.roundRect(bubble.x, bubble.y, bubble.w, bubble.h, 1.5)
          else ctx.rect(bubble.x, bubble.y, bubble.w, bubble.h)
          ctx.fill()
        }
      } else {
        // A padlock: body plus a stroked shackle.
        ctx.beginPath()
        ctx.arc(cx, cy - 1, 2.2, Math.PI, 0)
        ctx.stroke()
        ctx.fillRect(cx - 3, cy - 1, 6, 5)
      }
      ctx.restore()
    }

    /**
     * A gate into one mode of learning: real masonry with light drawn into it.
     * Layers run cheapest first on purpose — the ground pool alone already reads
     * as a portal, and everything after it is polish.
     */
    const drawPortal = (portal: PortalNode, seconds: number, cleared: boolean, active: boolean) => {
      const art = portalArt(portal.kind)
      const centreX = portal.at.x * TILE + TILE / 2
      const footY = portal.at.y * TILE + TILE
      const breath = 0.5 + 0.5 * Math.sin(seconds * 1.8)
      const locked = portal.locked

      ctx.save()
      if (locked) ctx.globalAlpha = 0.45

      // 1. The masonry, first rather than last: the sprite is opaque, so
      //    anything drawn under it is simply gone.
      drawArchFrame(art.frame, centreX, footY)

      // 2. The pool of light on the ground. Ten lines, and the single thing that
      //    makes the floor look lit rather than merely painted. Drawn over the
      //    slab so the foot of each pillar catches the light it is standing in.
      if (!locked && !cleared) {
        const radius = TILE * 1.5 + breath * (active ? 7 : 4)
        ctx.save()
        ctx.globalCompositeOperation = 'lighter'
        ctx.translate(centreX, footY - 2)
        ctx.scale(1, 0.42)
        const pool = ctx.createRadialGradient(0, 0, 0, 0, 0, radius)
        pool.addColorStop(0, withAlpha(art.glow, (active ? 0.9 : 0.65) * (0.65 + breath * 0.35)))
        pool.addColorStop(1, withAlpha(art.glow, 0))
        ctx.fillStyle = pool
        ctx.beginPath()
        ctx.arc(0, 0, radius, 0, Math.PI * 2)
        ctx.fill()
        ctx.restore()
      }

      // Cleared: the steady teal ring `drawMarker` gives a finished node,
      // widened to the gate. No breathing — done work should not ask for attention.
      if (cleared) {
        ctx.save()
        ctx.lineWidth = 1
        ctx.strokeStyle = 'rgba(79, 219, 200, 0.75)'
        ctx.beginPath()
        ctx.ellipse(centreX, footY - 2, TILE * 1.25, TILE * 0.5, 0, 0, Math.PI * 2)
        ctx.stroke()
        ctx.restore()
      }

      // 3. The vortex behind the stone. A sealed gate stays a hole in the wall:
      //    there is nothing on the other side to swirl.
      if (!locked) drawVortex(art, centreX, footY, seconds, cleared ? 0.5 : active ? 1 : 0.82)

      // 4. The rim. Load-bearing: it is the one edge that survives the biome
      //    tint multiplied over the room.
      ctx.save()
      ctx.lineWidth = active && !locked ? 2 : 1
      ctx.strokeStyle = locked ? LOCKED_RIM : art.rim
      archPath(centreX, footY)
      ctx.stroke()
      ctx.restore()

      // 5. Lanterns, when the kind carries any. A sealed gate gives off no light.
      if (art.lantern && !locked) {
        for (const offset of GATE_LANTERNS) drawStill(art.lantern, centreX + offset, footY)
      }

      // 6. The glyph, bobbing above the gate — or a tick once it is cleared,
      //    the same one `drawMarker` draws over a finished node. It clears the
      //    keystone: the masonry starts at row 2 of a 48px sprite dropped by
      //    `GATE_DROP`, so the top of the arch is 44 source pixels up.
      const glyphY = footY - 53 + Math.sin(seconds * 2.2) * 1.5
      if (cleared) {
        ctx.save()
        ctx.strokeStyle = '#4fdbc8'
        ctx.lineWidth = 1.5
        ctx.beginPath()
        ctx.moveTo(centreX - 4, glyphY)
        ctx.lineTo(centreX - 1, glyphY + 3)
        ctx.lineTo(centreX + 4, glyphY - 4)
        ctx.stroke()
        ctx.restore()
      } else {
        drawGlyph(locked ? 'lock' : art.icon, centreX, glyphY, locked ? LOCKED_RIM : art.rim)
      }

      ctx.restore()
    }

    const drawProps = (node: SceneNode, seconds: number) => {
      node.props.forEach((prop, i) => {
        const offset = PROP_OFFSETS[i % PROP_OFFSETS.length]
        const centreX = (node.at.x + offset.x) * TILE + TILE / 2
        const footY = (node.at.y + offset.y) * TILE + TILE
        const art = propArt(prop)
        if (art.kind === 'sprite') drawStill(art.sprite, centreX, footY)
        else drawChartFrame(centreX, footY - Math.sin(seconds * 1.6) * 0.5)
      })
    }

    let frame = 0
    const start = performance.now()

    const render = (now: number) => {
      frame = requestAnimationFrame(render)

      const seconds = (now - start) / 1000
      const body = player.current
      const { scale } = view
      const viewW = canvas.width / scale
      const viewH = canvas.height / scale

      const camX = Math.round(clampCamera(body.x * TILE - viewW / 2, viewW, map.width * TILE))
      const camY = Math.round(clampCamera(body.y * TILE - viewH / 2, viewH, map.height * TILE))

      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.imageSmoothingEnabled = false
      ctx.fillStyle = '#05080f'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.setTransform(scale, 0, 0, scale, -camX * scale, -camY * scale)

      // Only the tiles under the camera, with a one-tile margin so tall pieces
      // that hang over the edge are not clipped in half.
      const x0 = Math.max(0, Math.floor(camX / TILE) - 1)
      const y0 = Math.max(0, Math.floor(camY / TILE) - 2)
      const x1 = Math.min(map.width - 1, Math.ceil((camX + viewW) / TILE) + 1)
      const y1 = Math.min(map.height - 1, Math.ceil((camY + viewH) / TILE) + 2)

      const biomeAt = (x: number, y: number): Biome | null => {
        const index = roomIndex[y * map.width + x]
        return index >= 0 ? biomes[index] ?? null : null
      }

      // 1. Floor.
      for (let y = y0; y <= y1; y += 1) {
        for (let x = x0; x <= x1; x += 1) {
          if (tileAt(map, x, y) !== FLOOR) continue
          const biome = biomeAt(x, y)
          if (!biome) continue
          const sprite = image(biome.floor.src)
          if (sprite) ctx.drawImage(sprite, x * TILE, y * TILE, TILE, TILE)
        }
      }

      // 2. Wall faces, then wall tops. A wall whose neighbour below is floor is
      //    the piece the player sees head-on; everything else is its roof.
      for (let y = y0; y <= y1; y += 1) {
        for (let x = x0; x <= x1; x += 1) {
          if (tileAt(map, x, y) !== WALL || tileAt(map, x, y + 1) !== FLOOR) continue
          const biome = biomeAt(x, y)
          const sprite = biome && image(biome.wallFace.src)
          if (sprite) ctx.drawImage(sprite, x * TILE, y * TILE, TILE, TILE)
        }
      }
      for (let y = y0; y <= y1; y += 1) {
        for (let x = x0; x <= x1; x += 1) {
          if (tileAt(map, x, y) !== WALL || tileAt(map, x, y + 1) === FLOOR) continue
          const biome = biomeAt(x, y)
          const sprite = biome && image(biome.wallTop.src)
          if (sprite) ctx.drawImage(sprite, x * TILE, y * TILE, TILE, TILE)
        }
      }

      // 3. Each chapter's light, washed over its own room.
      ctx.save()
      ctx.globalCompositeOperation = 'multiply'
      map.rooms.forEach((room, i) => {
        const biome = biomes[i]
        if (!biome) return
        ctx.fillStyle = biome.tint
        ctx.fillRect((room.x - 1) * TILE, (room.y - 1) * TILE, (room.w + 2) * TILE, (room.h + 2) * TILE)
      })
      ctx.restore()

      // 4. Decor: texture only, never meaning.
      for (const placement of map.decor) {
        if (placement.at.x < x0 || placement.at.x > x1 || placement.at.y < y0 || placement.at.y > y1) continue
        const biome = biomeAt(placement.at.x, placement.at.y)
        if (!biome) continue
        const still = resolveDecor(biome, placement.sprite)
        if (still) drawStill(still, placement.at.x * TILE + TILE / 2, placement.at.y * TILE + TILE)
      }

      // 5. The gates. Drawn after the tint multiply so their light is never
      //    dimmed by it — the difference between glowing and muddy.
      for (const portal of map.portals) {
        if (portal.at.x < x0 - 3 || portal.at.x > x1 + 3 || portal.at.y < y0 - 3 || portal.at.y > y1 + 3) continue
        drawPortal(portal, seconds, clearedRef.current.has(portal.kind), activeRef.current === portal.kind)
      }

      // 5b. The guides. Pure decoration — an idle body beside each gate that
      //     says what is behind it without a word of text. Drawn after the
      //     arches so they stand *in* the light rather than under it, and before
      //     the player so walking past one reads correctly in depth. The tile
      //     comes from `hubgen` so the two can never drift apart.
      for (const portal of map.portals) {
        if (!portal.guide) continue
        const tile = guideTileFor(portal)
        if (tile.x < x0 - 3 || tile.x > x1 + 3 || tile.y < y0 - 3 || tile.y > y1 + 3) continue
        const centreX = tile.x * TILE + TILE / 2
        const footY = tile.y * TILE + TILE
        drawShadow(centreX, footY)
        drawAnim(actorArt(portal.guide).idle, centreX, footY, seconds, false)
      }

      const visibleNodes = map.nodes.filter(
        (node) => node.at.x >= x0 - 2 && node.at.x <= x1 + 2 && node.at.y >= y0 - 2 && node.at.y <= y1 + 2,
      )

      // 6. Props, 7. markers, 8. actors — each scene as one little tableau.
      //    All three are inert on a hub map, which carries `nodes: []`.
      for (const node of visibleNodes) drawProps(node, seconds)

      for (const node of visibleNodes) {
        const centreX = node.at.x * TILE + TILE / 2
        const footY = node.at.y * TILE + TILE
        drawMarker(centreX, footY, seconds, NO_COMPLETED_SCENES.has(node.sceneId), false)
      }

      for (const node of visibleNodes) {
        const centreX = node.at.x * TILE + TILE / 2
        const footY = node.at.y * TILE + TILE
        drawShadow(centreX, footY)
        drawAnim(actorArt(node.actor).idle, centreX, footY, seconds, false)
      }

      // 9. The player, on top of the world they are walking through.
      const art = actorArt(PLAYER_ACTOR)
      const anim = body.moving && art.run ? art.run : art.idle
      const playerX = body.x * TILE
      const playerFoot = body.y * TILE + TILE * 0.45
      drawShadow(playerX, playerFoot)
      drawAnim(anim, playerX, playerFoot, seconds, body.facing === 'left')

      // A vignette in screen space, to pull the eye to the middle of the room.
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      const vignette = ctx.createRadialGradient(
        canvas.width / 2,
        canvas.height / 2,
        Math.min(canvas.width, canvas.height) * 0.35,
        canvas.width / 2,
        canvas.height / 2,
        Math.max(canvas.width, canvas.height) * 0.72,
      )
      vignette.addColorStop(0, 'rgba(5, 8, 15, 0)')
      vignette.addColorStop(1, 'rgba(5, 8, 15, 0.72)')
      ctx.fillStyle = vignette
      ctx.fillRect(0, 0, canvas.width, canvas.height)
    }

    frame = requestAnimationFrame(render)

    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [map, images, player, roomIndex, biomes])

  return (
    <div ref={wrapperRef} className="absolute inset-0 overflow-hidden bg-[#05080f]">
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={`${map.title}: a pixel-art world with ${map.portals.length} gates and ${map.nodes.length} scenes. Walk with the arrow keys or WASD.`}
        className="block h-full w-full [image-rendering:pixelated]"
      />
      {!images && (
        <div className="absolute inset-0 grid place-items-center bg-background/90" role="status" aria-live="polite">
          <div className="text-center">
            <span className="mx-auto grid h-12 w-12 animate-pulse place-items-center rounded-xl bg-primary font-black text-background">
              CQ
            </span>
            <p className="mt-4 text-sm font-semibold text-ink-muted">Building {map.title}…</p>
          </div>
        </div>
      )}
    </div>
  )
}
