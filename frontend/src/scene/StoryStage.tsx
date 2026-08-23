/**
 * The picture at the top of a storybook page: the room the chapter happens in.
 *
 * ## Why this is not `SceneIllustration`
 *
 * `SceneIllustration` draws a scene's props against nothing, and it is right to
 * — it renders inside a shell whose background is the live world, so the props
 * are already standing somewhere. The reading portal is the one place that is
 * not true of: the learner opened it from a hub that looks the same for every
 * chapter, so a row of sprites on a flat panel is the only picture there is,
 * and it reads as clip art rather than as a place.
 *
 * A chapter already declares where it happens — `Chapter.background` is one of
 * six biomes, chosen by the generator off the source material — and
 * `vocabulary.ts` already knows what each biome's floor, walls, decor and wash
 * look like, because the world is built out of exactly those tiles. So the band
 * is built the same way the room is: wall top, wall face, floor, the biome's
 * decor along the back, the chapter's props standing on the floor line, and the
 * biome's tint over all of it.
 *
 * Nothing here is a new asset and nothing is a new claim. The place is the
 * chapter's, the props are the scenes' own, and the tiles are the ones the
 * learner has been walking on.
 *
 * ## What it will not do
 *
 * - **No background declared and no props: nothing renders.** Not an empty
 *   room, not a placeholder. A page with nothing to show takes up no room.
 * - **Props are never invented or substituted.** An empty `props` gives an
 *   empty room, which is honest: the chapter said where it happens and did not
 *   say what is in it.
 * - **No randomness.** Decor sits at fixed fractions of the width, so the same
 *   chapter draws the same picture on every render and every reload.
 */

import type { CSSProperties } from 'react'
import type { Background, Prop } from '../api/types'
import { biomeFor, propArt } from './vocabulary'
import { CHART_BOX, ChartFrame } from './vn'

/**
 * World pixels per source pixel. Whole-number only — pixel art at 3.5x is
 * pixel art with the pixels ruined — and 4 is the size the tiles read at on a
 * laptop without the band eating the page.
 */
const SCALE = 4
const TILE = 16 * SCALE

/** Band height: one row of floor, one of wall top, and headroom for a prop. */
const FLOOR_ROWS = 2
const HEIGHT = TILE * 3.5

/**
 * Where the decor stands, as fractions of the band's width.
 *
 * Along the back wall and away from the middle, which is where the props are.
 * Fixed rather than derived from anything: two pieces of scenery do not need a
 * layout engine, and a deterministic picture is one the learner can recognise
 * when they come back to the page.
 */
const DECOR_SPOTS = [0.11, 0.87]

/**
 * How far up the floor a thing stands, as a fraction of the floor's depth.
 *
 * The floor is drawn as a receding plane, so this is depth, not height: the
 * biome's scenery stands near the back wall and the chapter's own props stand
 * in front of it with floor still visible under them. Both on the floor and
 * neither on the seam, which is what stops the row reading as a shelf.
 */
const DECOR_DEPTH = 0.78
const PROP_DEPTH = 0.42

/**
 * Props that give off light, and the colour they give off.
 *
 * The sprite pack contains nothing emissive — `vocabulary.ts` says so where it
 * explains why the portal's glow is drawn in code rather than cut from the
 * sheet — so a lantern is a dark lantern until something behind it says
 * otherwise. This is that something, and it is the same liberty the portals
 * already take: the *object* is the content's, the light is the renderer's.
 * Anything not named here is simply not lit.
 */
const EMISSIVE: Partial<Record<Prop, string>> = {
  lantern: 'rgba(255, 196, 106, 0.55)',
  crystal_cluster: 'rgba(120, 214, 255, 0.42)',
}

export interface StoryStageProps {
  /** Where the chapter happens. Null renders the props with no room at all. */
  background: Background | null
  /** Exactly what the chapter's scenes declared. Empty renders an empty room. */
  props: readonly Prop[]
  /** A line under the picture — the chapter's own title. Blank omits it. */
  caption?: string
  /** Colour for the caption, usually the portal's rim. */
  accent?: string
}

/** A prop's source size, sprite or drawn. */
const boxOf = (prop: Prop): { w: number; h: number } => {
  const art = propArt(prop)
  return art.kind === 'sprite' ? { w: art.sprite.w, h: art.sprite.h } : { w: CHART_BOX.w, h: CHART_BOX.h }
}

/** One tile, repeated. `pixelated` is what keeps 16px art from turning to soup. */
const tiled = (src: string): CSSProperties => ({
  backgroundImage: `url(${src})`,
  backgroundRepeat: 'repeat',
  backgroundSize: `${TILE}px ${TILE}px`,
  imageRendering: 'pixelated',
})

export function StoryStage({ background, props, caption, accent }: StoryStageProps) {
  const showCaption = typeof caption === 'string' && caption.trim().length > 0

  // Nothing declared anywhere: the page opens straight onto its text.
  if (background === null && props.length === 0) return null

  const biome = background === null ? null : biomeFor(background)
  const floorHeight = TILE * FLOOR_ROWS
  const propFoot = floorHeight * PROP_DEPTH
  const decorFoot = floorHeight * DECOR_DEPTH
  // Everything standing in the room has to fit inside it. Growing the band for
  // a tall piece beats cropping the piece, and both the chapter's props and the
  // biome's own scenery get a vote — a banner is taller than most props.
  const tallestProp = props.length === 0 ? 0 : Math.max(...props.map((prop) => boxOf(prop).h))
  const tallestDecor = biome === null ? 0 : Math.max(0, ...biome.decor.map((piece) => piece.h))
  const height = Math.max(
    HEIGHT,
    tallestProp * SCALE + propFoot + TILE * 0.5,
    tallestDecor * SCALE + decorFoot + TILE * 0.35,
  )

  return (
    <figure className="flex flex-col items-center gap-3">
      <div
        className="relative w-full overflow-hidden rounded-2xl border border-white/10"
        style={{ height }}
      >
        {biome && (
          <>
            {/* The room, built the way the world builds it: top, face, floor. */}
            <div
              aria-hidden="true"
              className="absolute inset-x-0 top-0"
              style={{ ...tiled(biome.wallFace.src), bottom: floorHeight }}
            />
            <div
              aria-hidden="true"
              className="absolute inset-x-0 top-0"
              style={{ ...tiled(biome.wallTop.src), height: TILE }}
            />
            <div
              aria-hidden="true"
              className="absolute inset-x-0 bottom-0"
              style={{ ...tiled(biome.floor.src), height: floorHeight }}
            />

            {/* The biome's own scenery, standing where the floor begins. */}
            {biome.decor.map((piece, i) => {
              const spot = DECOR_SPOTS[i % DECOR_SPOTS.length]
              return (
                <img
                  key={`${piece.src}-${i}`}
                  src={piece.src}
                  alt=""
                  aria-hidden="true"
                  width={piece.w * SCALE}
                  height={piece.h * SCALE}
                  className="absolute"
                  style={{
                    left: `${spot * 100}%`,
                    bottom: decorFoot,
                    transform: 'translateX(-50%)',
                    imageRendering: 'pixelated',
                    opacity: 0.85,
                  }}
                />
              )
            })}

            {/* Where the wall meets the ground. Without it the two tile sets
                read as one flat texture and the room has no floor. */}
            <div
              aria-hidden="true"
              className="absolute inset-x-0"
              style={{
                bottom: floorHeight,
                height: 2,
                background: 'rgba(0, 0, 0, 0.45)',
                boxShadow: '0 6px 14px rgba(0, 0, 0, 0.55)',
              }}
            />

            {/* The wash that makes a chapter read as somewhere of its own. */}
            <div aria-hidden="true" className="absolute inset-0" style={{ background: biome.tint }} />
          </>
        )}

        {/* Depth, so the band sits under the text instead of shouting over it. */}
        <div
          aria-hidden="true"
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(to bottom, rgba(5,8,15,0.62), rgba(5,8,15,0.05) 40%, rgba(5,8,15,0) 78%, rgba(5,8,15,0.28))',
          }}
        />

        {/* What the chapter put in the room, standing on the floor line. */}
        <div
          className="absolute inset-x-0 flex items-end justify-center gap-8"
          style={{ bottom: propFoot }}
        >
          {props.map((prop, i) => {
            const box = boxOf(prop)
            const w = box.w * SCALE
            const h = box.h * SCALE
            const art = propArt(prop)
            const light = EMISSIVE[prop]
            return (
              <div key={`${prop}-${i}`} className="relative flex flex-col items-center">
                {light && (
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute"
                    style={{
                      width: w * 3.5,
                      height: w * 3.5,
                      left: '50%',
                      top: '50%',
                      transform: 'translate(-50%, -50%)',
                      background: `radial-gradient(closest-side, ${light}, transparent 70%)`,
                    }}
                  />
                )}
                <div className="relative" style={{ width: w, height: h }}>
                  {art.kind === 'sprite' ? (
                    <img
                      src={art.sprite.src}
                      // Decorative: the picture is the point, and a sprite's
                      // enum name is vocabulary the learner has no use for.
                      alt=""
                      width={w}
                      height={h}
                      className="block"
                      style={{ imageRendering: 'pixelated' }}
                    />
                  ) : (
                    <ChartFrame />
                  )}
                </div>
                {/* The same ellipse the canvas puts under anything standing on
                    the floor, so the piece has weight rather than floating. */}
                <div
                  aria-hidden="true"
                  className="relative rounded-full"
                  style={{
                    width: Math.round(w * 0.8),
                    height: Math.max(6, SCALE * 1.5),
                    marginTop: -SCALE,
                    background: 'radial-gradient(closest-side, rgba(0,0,0,0.55), rgba(0,0,0,0))',
                  }}
                />
              </div>
            )
          })}
        </div>
      </div>

      {showCaption && (
        <figcaption
          className="font-hud text-[11px] uppercase tracking-[0.14em]"
          style={{ color: accent ?? '#8f9ac0' }}
        >
          {caption}
        </figcaption>
      )}
    </figure>
  )
}
