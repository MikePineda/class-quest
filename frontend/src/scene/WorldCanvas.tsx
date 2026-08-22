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
import { FLOOR, TILE, WALL, tileAt } from './types'
import type { Anim, Biome, SceneNode, Still, WorldMap } from './types'
import type { PlayerBody } from './usePlayer'
import { actorArt, biomeFor, propArt } from './vocabulary'

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

export interface WorldCanvasProps {
  map: WorldMap
  /** Live player state, read once per frame. */
  player: RefObject<PlayerBody>
  /** Scene ids the learner has finished. */
  completed: ReadonlySet<string>
  /** The node the player is standing on, highlighted harder than the rest. */
  activeSceneId: string | null
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

export function WorldCanvas({ map, player, completed, activeSceneId }: WorldCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  // Keyed by the map it was loaded for, so a new map reads as "not ready yet"
  // during render instead of needing a synchronous reset in an effect.
  const [loaded, setLoaded] = useState<{ map: WorldMap; cache: Map<string, HTMLImageElement> } | null>(null)
  const images = loaded?.map === map ? loaded.cache : null

  const roomIndex = useMemo(() => buildRoomIndex(map), [map])
  const biomes = useMemo(() => map.rooms.map((room) => biomeFor(room.background)), [map])
  // Frame-local inputs the loop must see without being torn down and rebuilt.
  const completedRef = useRef(completed)
  const activeRef = useRef(activeSceneId)
  useEffect(() => {
    completedRef.current = completed
    activeRef.current = activeSceneId
  }, [completed, activeSceneId])

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
     */
    const drawChartFrame = (centreX: number, footY: number) => {
      const w = 34
      const h = 26
      const x = Math.round(centreX - w / 2)
      const y = Math.round(footY - h - 6)

      ctx.save()
      ctx.fillStyle = 'rgba(11, 19, 38, 0.9)'
      ctx.fillRect(x, y, w, h)
      ctx.lineWidth = 1
      ctx.strokeStyle = 'rgba(79, 219, 200, 0.75)'
      ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1)

      ctx.strokeStyle = 'rgba(218, 226, 253, 0.25)'
      ctx.beginPath()
      ctx.moveTo(x + 4.5, y + 3.5)
      ctx.lineTo(x + 4.5, y + h - 4.5)
      ctx.lineTo(x + w - 3.5, y + h - 4.5)
      ctx.stroke()

      // Training loss: down and to the right, forever.
      ctx.strokeStyle = '#f59e0b'
      ctx.beginPath()
      for (let i = 0; i <= 22; i += 1) {
        const t = i / 22
        const px = x + 5 + t * (w - 9)
        const py = y + 6 + (1 - t) ** 1.6 * (h - 12)
        if (i === 0) ctx.moveTo(px, py)
        else ctx.lineTo(px, py)
      }
      ctx.stroke()

      // Validation loss: down, then back up. The gap is the point.
      ctx.strokeStyle = '#4fdbc8'
      ctx.beginPath()
      for (let i = 0; i <= 22; i += 1) {
        const t = i / 22
        const px = x + 5 + t * (w - 9)
        const py = y + 6 + (h - 12) * (0.15 + 3.4 * (t - 0.42) ** 2)
        if (i === 0) ctx.moveTo(px, py)
        else ctx.lineTo(px, py)
      }
      ctx.stroke()
      ctx.restore()
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

      const visibleNodes = map.nodes.filter(
        (node) => node.at.x >= x0 - 2 && node.at.x <= x1 + 2 && node.at.y >= y0 - 2 && node.at.y <= y1 + 2,
      )

      // 5. Props, 6. markers, 7. actors — each scene as one little tableau.
      for (const node of visibleNodes) drawProps(node, seconds)

      for (const node of visibleNodes) {
        const centreX = node.at.x * TILE + TILE / 2
        const footY = node.at.y * TILE + TILE
        drawMarker(centreX, footY, seconds, completedRef.current.has(node.sceneId), activeRef.current === node.sceneId)
      }

      for (const node of visibleNodes) {
        const centreX = node.at.x * TILE + TILE / 2
        const footY = node.at.y * TILE + TILE
        drawShadow(centreX, footY)
        drawAnim(actorArt(node.actor).idle, centreX, footY, seconds, false)
      }

      // 8. The player, on top of the world they are walking through.
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
        aria-label={`${map.title}: a pixel-art world with ${map.nodes.length} scenes. Walk with the arrow keys or WASD.`}
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
