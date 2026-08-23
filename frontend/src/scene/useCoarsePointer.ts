/**
 * Is this a touch device?
 *
 * Two signals, OR'd, latched on and never off.
 *
 * The media query answers on the very first render, which is what matters:
 * the learner has to *see* the thumbstick before touching anything, so a
 * design that waits for a touch shows keyboard hints to somebody holding a
 * phone. The first `touchstart` is ground truth and catches what the query
 * gets wrong — touchscreen laptops report `pointer: fine`, and so does device
 * emulation in devtools.
 *
 * Never un-set: a control layer that flickers away mid-session on a hybrid
 * machine is worse than one that is merely redundant.
 *
 * Deliberately not used: `'ontouchstart' in window`, which is true in desktop
 * Chrome; `any-pointer: coarse`, which is true of a desktop with a drawing
 * tablet plugged in; and a width breakpoint, because a narrow desktop window
 * is not a phone — which is exactly what the `sm:`-gated keyboard hints in the
 * world HUD used to get wrong.
 */
import { useEffect, useState } from 'react'

const COARSE = '(pointer: coarse)'

export function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(
    () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(COARSE).matches,
  )

  useEffect(() => {
    if (coarse) return
    const query = window.matchMedia(COARSE)
    const onChange = () => {
      if (query.matches) setCoarse(true)
    }
    const onTouch = () => setCoarse(true)
    query.addEventListener('change', onChange)
    window.addEventListener('touchstart', onTouch, { passive: true, once: true })
    return () => {
      query.removeEventListener('change', onChange)
      window.removeEventListener('touchstart', onTouch)
    }
  }, [coarse])

  return coarse
}
