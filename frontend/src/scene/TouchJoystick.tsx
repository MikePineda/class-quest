/**
 * A floating thumbstick. Press anywhere in the zone and the ring appears under
 * your thumb; drag from there to steer. Nothing to aim at, which is the point —
 * on a phone you are looking at the world, not at the controls.
 *
 * Two React renders per gesture, not sixty: the ring's position is state, set
 * once on press and cleared on release, while the knob is moved by writing its
 * transform directly. That is the same bargain `usePlayer` makes for the body,
 * and for the same reason — none of this is anything the DOM needs to know.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { clampToRadius, stickVector } from './input'
import type { Point } from './types'

export interface TouchJoystickProps {
  /** Called with the intent vector, |v| <= 1, and with (0, 0) on release. */
  onVector: (x: number, y: number) => void
  /** False while a portal is open: the world is frozen, so the stick should be too. */
  enabled: boolean
  className?: string
}

export function TouchJoystick({ onVector, enabled, className = '' }: TouchJoystickProps) {
  /**
   * Which pointer owns the stick. Capture is per-pointer, so this is what lets
   * a second thumb work the action button without teleporting the stick.
   */
  const owner = useRef<number | null>(null)
  const origin = useRef<Point>({ x: 0, y: 0 })
  const knobRef = useRef<HTMLDivElement | null>(null)
  const [ring, setRing] = useState<Point | null>(null)

  const stop = useCallback(() => {
    owner.current = null
    setRing(null)
    onVector(0, 0)
  }, [onVector])

  // A gesture interrupted by unmounting, or by a portal opening under the
  // thumb, still has to release the player.
  useEffect(() => () => onVector(0, 0), [onVector])
  useEffect(() => {
    if (!enabled && owner.current !== null) stop()
  }, [enabled, stop])

  if (!enabled) return null

  const down = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (owner.current !== null) return
    if (event.pointerType === 'mouse' && event.button !== 0) return
    owner.current = event.pointerId
    origin.current = { x: event.clientX, y: event.clientY }
    const box = event.currentTarget.getBoundingClientRect()
    setRing({ x: event.clientX - box.left, y: event.clientY - box.top })
    // The drag will leave the zone; capture keeps the moves coming.
    event.currentTarget.setPointerCapture(event.pointerId)
    // No preventDefault: `touch-action: none` already suppresses scroll and
    // zoom here, and preventing the default on pointerdown breaks implicit
    // capture on some engines.
    onVector(0, 0)
  }

  const move = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerId !== owner.current) return
    const dx = event.clientX - origin.current.x
    const dy = event.clientY - origin.current.y
    const knob = clampToRadius(dx, dy)
    if (knobRef.current) {
      knobRef.current.style.transform = `translate3d(${knob.x}px, ${knob.y}px, 0)`
    }
    const vector = stickVector(dx, dy)
    onVector(vector.x, vector.y)
  }

  const up = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerId !== owner.current) return
    stop()
  }

  return (
    <div
      // Pointer-only, and a duplicate of the arrow keys. A focusable control
      // nobody can drag would be worse than none.
      aria-hidden="true"
      className={`pointer-events-auto touch-none select-none [-webkit-tap-highlight-color:transparent] [-webkit-touch-callout:none] ${className}`.trim()}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onLostPointerCapture={up}
    >
      {ring === null ? (
        // The affordance: something to press, before there is anything to drag.
        <div className="pointer-events-none absolute bottom-10 left-6 grid h-28 w-28 place-items-center rounded-full border border-dashed border-white/25 opacity-40">
          <span className="font-hud text-[9px] leading-tight tracking-[0.1em] text-ink-muted">DRAG<br />TO WALK</span>
        </div>
      ) : (
        <div
          className="pointer-events-none absolute grid h-32 w-32 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-white/20 bg-white/5 backdrop-blur-sm"
          style={{ left: ring.x, top: ring.y }}
        >
          <div className="absolute inset-3 rounded-full border border-secondary/25" />
          {/*
            No `transform` in the style prop, deliberately. This component
            re-renders whenever the world does — which is every time the player
            crosses a tile — and React would reapply the prop and snap the knob
            back to the centre mid-drag. The pointermove handler is the only
            owner of this transform; a fresh gesture mounts a fresh knob,
            because the ring unmounts on release.
          */}
          <div
            ref={knobRef}
            className="h-14 w-14 rounded-full border border-white/40 bg-secondary/70 shadow-[0_0_18px_rgba(67,217,196,0.45)]"
          />
        </div>
      )}
    </div>
  )
}
