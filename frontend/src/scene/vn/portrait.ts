/**
 * Turning an actor's idle sheet into a portrait.
 *
 * The sprite pack has no portrait art and none is being invented: a portrait
 * here is one frame of the idle sheet the world already walks, blown up by a
 * whole number and stepped through with CSS. `mentor_owl` is already used this
 * way as a plain 32x32 `<img>` in `ExplainPanel`; this only generalises it to
 * the actors whose sheets carry more than one frame.
 *
 * Pure on purpose — no DOM, no React — so the arithmetic that decides how big a
 * pixel is can be checked without a browser.
 */

import type { Actor } from '../../api/types'
import { actorArt } from '../vocabulary'

/**
 * What to call each actor on a name tag.
 *
 * These name a *character*, the way the sprite draws one; they are not content.
 * The generator never sees them and no schema field carries them. A caller with
 * a better name — a speaker the content actually named — passes its own.
 */
export const ACTOR_DISPLAY_NAMES: Record<Actor, string> = {
  explorer: 'You',
  mentor_owl: 'The Owl',
  rival: 'The Rival',
  villager: 'The Storyteller',
}

export const actorDisplayName = (actor: Actor): string => ACTOR_DISPLAY_NAMES[actor]

export interface PortraitSheet {
  src: string
  /** Source pixels per frame. Idle sheets are square. */
  frame: number
  frames: number
  /** Whole-number zoom, so a source pixel stays a square block of screen pixels. */
  scale: number
  /** Rendered size of one frame, in CSS pixels. */
  size: number
  /** Rendered size of the whole strip, in CSS pixels. */
  sheetWidth: number
  /** Seconds for one loop of the idle, or null for a sheet with one frame. */
  loopSeconds: number | null
}

/**
 * The portrait for an actor, sized to fit `box` CSS pixels.
 *
 * The zoom is floored to a whole number and never below 1: a portrait scaled by
 * 2.4 is a blurry portrait, and blurring pixel art is the one thing the whole
 * renderer is built to avoid. A box smaller than a source frame therefore
 * renders at 1:1 rather than shrinking.
 */
export function portraitSheet(actor: Actor, box: number): PortraitSheet {
  const { idle } = actorArt(actor)
  const frames = Math.max(1, idle.frames)
  const scale = Math.max(1, Math.floor(box / idle.frame))
  const size = idle.frame * scale
  return {
    src: idle.src,
    frame: idle.frame,
    frames,
    scale,
    size,
    sheetWidth: size * frames,
    // A single frame has no cadence to play — `vocabulary` parks its fps at 1
    // rather than faking one, and so does this.
    loopSeconds: frames > 1 ? frames / idle.fps : null,
  }
}
