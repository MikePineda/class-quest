/**
 * A line of dialogue arriving the way a visual novel delivers one.
 *
 * Two rules make it safe to put over pedagogical text:
 *
 *  - **it is capped in wall-clock time, not per character**, so a four-word
 *    line and a four-sentence one both finish in the same fraction of a second.
 *    A typewriter that charges by the letter turns a long, honest explanation
 *    into a punishment for reading;
 *  - **it never withholds anything.** The full text is in the DOM the moment
 *    the animation ends, and under `prefers-reduced-motion` it is there from
 *    the first frame. Nothing the learner needs is gated behind an effect.
 */

import { useEffect, useState } from 'react'

/** The whole line is out by then, however long it is. */
const REVEAL_MS = 620

const prefersReducedMotion = (): boolean => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function useTypedLine(text: string, enabled = true): string {
  const animate = enabled && text.length > 0 && !prefersReducedMotion()
  const [state, setState] = useState(() => ({ text, shown: animate ? '' : text }))

  // A new line resets the reveal during the render that brings it in, not in an
  // effect afterwards: an effect would paint one frame of the previous line's
  // text under the new speaker before catching up.
  if (state.text !== text) setState({ text, shown: animate ? '' : text })

  useEffect(() => {
    if (!animate) return
    let frame = 0
    const start = performance.now()
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / REVEAL_MS)
      setState({ text, shown: text.slice(0, Math.ceil(progress * text.length)) })
      if (progress < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [text, animate])

  return state.text === text ? state.shown : animate ? '' : text
}
