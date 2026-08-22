/**
 * The illustration slot: the props a scene actually declared, and nothing else.
 *
 * `Scene.props` is a list of at most three names from a closed enum
 * (`schema/game.schema.json`). The generator picked them off the source
 * material; the client only decides what each name looks like, which is what
 * `vocabulary.ts` is for. So this component has exactly one job — draw the
 * declared props at reading size — and one rule:
 *
 * **A scene that declared no props gets no illustration.** Not a placeholder,
 * not a stock image, not a decorative stand-in chosen because the layout looks
 * better with something in the slot. An invented illustration is invented
 * course material: it tells the learner the content said something about a
 * chest or a chart when it did not. Empty means the slot is absent and the
 * bands below it close up.
 *
 * Five of the six props are sprites and are blitted from the paths in
 * `vocabulary.ts`; `chart_frame` is drawn, and comes back as vectors from
 * `ChartFrame` so the curve survives the blow-up.
 */

import type { Prop } from '../../api/types'
import { propArt } from '../vocabulary'
import { CHART_BOX } from './chartFrameArt'
import { ChartFrame } from './ChartFrame'

/** Whole-number zoom only: pixel art scaled by 2.4 is pixel art with the pixels ruined. */
const MIN_SCALE = 2
/** A 16x16 crystal at 8x is already 128px tall. Past that it stops reading as art. */
const MAX_SCALE = 8

export interface SceneIllustrationProps {
  /**
   * Exactly what the scene declared, straight off `Scene.props`. Undefined (a
   * simulation scene has no `props` field at all) and empty both render
   * nothing — see the note above.
   */
  props?: readonly Prop[]
  /**
   * A line under the picture. The mockup puts the concept's name here, which is
   * the learner's own material and safe to show; blank or absent omits it.
   */
  caption?: string
  /** Colour for the caption, usually the portal's rim. Defaults to muted ink. */
  accent?: string
  /** The tallest the band may grow, in CSS pixels. The zoom is fitted to it. */
  height?: number
  className?: string
}

/** A prop's source size, whether it is blitted or drawn. */
function boxOf(prop: Prop): { w: number; h: number } {
  const art = propArt(prop)
  return art.kind === 'sprite' ? { w: art.sprite.w, h: art.sprite.h } : { w: CHART_BOX.w, h: CHART_BOX.h }
}

export function SceneIllustration({
  props,
  caption,
  accent,
  height = 176,
  className,
}: SceneIllustrationProps) {
  const declared = props ?? []
  if (declared.length === 0) return null

  // One zoom for the whole row, fitted to the tallest piece, so two props keep
  // the size relationship they have in the world instead of both filling the band.
  const tallest = Math.max(...declared.map((prop) => boxOf(prop).h))
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.floor(height / tallest)))
  const showCaption = typeof caption === 'string' && caption.trim().length > 0

  return (
    <figure className={`flex flex-col items-center gap-3 ${className ?? ''}`}>
      {/* Bottom-aligned: the props stand on one floor line, the way they do in
          the room the learner just walked out of. */}
      <div className="flex items-end justify-center gap-6" style={{ minHeight: height }}>
        {declared.map((prop, i) => {
          const box = boxOf(prop)
          const w = box.w * scale
          const h = box.h * scale
          const art = propArt(prop)
          return (
            <div key={`${prop}-${i}`} className="flex flex-col items-center">
              <div style={{ width: w, height: h }}>
                {art.kind === 'sprite' ? (
                  <img
                    src={art.sprite.src}
                    // Decorative: the picture is the point, and a sprite's enum
                    // name is vocabulary the learner has no use for.
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
              {/* The same little ellipse the canvas puts under everything that
                  stands on the floor, so the piece has weight. */}
              <div
                aria-hidden="true"
                className="mt-1 rounded-full"
                style={{
                  width: Math.round(w * 0.8),
                  height: Math.max(6, Math.round(scale * 1.5)),
                  background: 'radial-gradient(closest-side, rgba(0, 0, 0, 0.5), rgba(0, 0, 0, 0))',
                }}
              />
            </div>
          )
        })}
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
