/**
 * The speaker: a framed portrait with a name tag, the way a visual novel puts a
 * character on screen.
 *
 * There is no portrait art in this repo and none is being commissioned. The
 * portrait is one frame of the actor's own idle sheet, blown up by a whole
 * number and stepped through with CSS so the character breathes rather than
 * sitting there as a sticker. `ExplainPanel` already does the still version of
 * this with the owl at 32x32; this is the same idea with the frame maths done
 * properly, so the three four-frame sheets work too.
 */

import type { CSSProperties } from 'react'

import type { Actor } from '../../api/types'
import type { PortalKind } from '../types'
import { portalArt } from '../vocabulary'
import { actorDisplayName, portraitSheet } from './portrait'
import { VN_CSS, VN_STYLE_HREF } from './vnCss'

export interface VnPortraitProps {
  actor: Actor
  /**
   * What the name tag reads. Defaults to the actor's own display name; pass a
   * name the content gave the speaker when there is one.
   */
  name?: string
  /** Which portal's light the frame is lit by. */
  kind: PortalKind
  /** Size of the framed box in CSS pixels. The zoom is fitted inside it. */
  size?: number
  className?: string
}

export function VnPortrait({ actor, name, kind, size = 112, className }: VnPortraitProps) {
  const art = portalArt(kind)
  // The frame has a border and a little air, so the sprite is fitted to the inside.
  const sheet = portraitSheet(actor, size - 16)
  const label = name?.trim() || actorDisplayName(actor)

  const spriteStyle: CSSProperties = {
    width: sheet.size,
    height: sheet.size,
    backgroundImage: `url(${sheet.src})`,
    backgroundSize: `${sheet.sheetWidth}px ${sheet.size}px`,
    backgroundRepeat: 'no-repeat',
    imageRendering: 'pixelated',
    ...(sheet.loopSeconds
      ? ({
          animation: `cq-vn-idle ${sheet.loopSeconds}s steps(${sheet.frames}) infinite`,
          '--cq-vn-sheet': `-${sheet.sheetWidth}px`,
        } as CSSProperties)
      : null),
  }

  return (
    <div className={`flex shrink-0 flex-col items-center ${className ?? ''}`}>
      <style href={VN_STYLE_HREF} precedence="medium">
        {VN_CSS}
      </style>
      <div
        className="relative grid place-items-center overflow-hidden rounded-xl border"
        style={{
          width: size,
          height: size,
          borderColor: art.rim,
          // Light from the portal behind them, pooling at their feet.
          background: `radial-gradient(120% 80% at 50% 108%, ${art.glow}, rgba(10, 14, 26, 0.92) 68%)`,
          boxShadow: `0 0 22px ${art.glow}, inset 0 0 18px rgba(0, 0, 0, 0.55)`,
        }}
      >
        <div aria-hidden="true" style={spriteStyle} />
        <div aria-hidden="true" className="cq-vn-scan pointer-events-none absolute inset-0 opacity-60" />
      </div>
      {/* The tag rides on the frame's bottom edge, which is where a name tag
          goes; `z-10` keeps it over the frame's inner shadow. */}
      <span
        className="relative z-10 -mt-2.5 max-w-[10rem] truncate rounded-md border px-2.5 py-1 font-hud text-[10px] uppercase tracking-[0.12em]"
        style={{
          borderColor: art.rim,
          color: art.rim,
          backgroundColor: '#0d1220',
        }}
      >
        {label}
      </span>
    </div>
  )
}
