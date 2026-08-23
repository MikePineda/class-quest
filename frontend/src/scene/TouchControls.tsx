/**
 * The controls a phone needs, and the three things that were keyboard-only.
 *
 * Walking, opening a portal and leaving were the whole gap: every panel behind
 * a portal was already tappable, because its choices, page turns and close
 * button are real buttons and the key shortcuts are extras. So this is a
 * thumbstick on the left and one action button on the right.
 */
import { portalArt } from './vocabulary'
import { TouchJoystick } from './TouchJoystick'
import type { PortalNode } from './types'

export interface TouchControlsProps {
  /** Writes the stick's intent straight into the movement loop. Stable identity. */
  onVector: (x: number, y: number) => void
  /** The gate the player is standing at, if any. */
  portal: PortalNode | null
  onEnter: () => void
  /** False while a portal is open — the world behind it is frozen. */
  enabled: boolean
}

export function TouchControls({ onVector, portal, onEnter, enabled }: TouchControlsProps) {
  // A locked gate advertises no way in, on touch for the same reason it does
  // not advertise a key: the prompt says what is behind the door without
  // promising it opens.
  const canEnter = enabled && portal !== null && !portal.locked
  const art = portal ? portalArt(portal.kind) : null

  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      {/*
        Left half, and inset from the edge: the iOS back-swipe is a system
        gesture that cannot be prevented, so a zone flush against left-0
        navigates away mid-walk. Starting below the HUD keeps the two apart.
      */}
      <TouchJoystick
        onVector={onVector}
        enabled={enabled}
        className="absolute bottom-0 left-4 top-32 w-1/2 pb-[env(safe-area-inset-bottom)]"
      />

      {canEnter && art && (
        <button
          type="button"
          // A real button, so it is still a button for a keyboard and for a
          // screen reader; `onClick` rather than `onPointerDown` because
          // width=device-width already removes the 300ms tap delay.
          onClick={onEnter}
          aria-keyshortcuts="e"
          className="pointer-events-auto absolute right-5 grid h-20 w-20 touch-manipulation place-items-center rounded-full border-2 text-center font-hud text-[10px] leading-tight tracking-[0.08em] text-ink shadow-2xl shadow-black/50 backdrop-blur transition active:scale-95"
          style={{
            bottom: 'max(1.5rem, env(safe-area-inset-bottom))',
            borderColor: art.rim,
            backgroundColor: `${art.core}59`,
            boxShadow: `0 0 22px ${art.glow}`,
          }}
        >
          ENTER
        </button>
      )}
    </div>
  )
}
