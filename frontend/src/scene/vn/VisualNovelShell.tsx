/**
 * The visual-novel shell: the chassis every portal is played inside.
 *
 * Walking onto a portal used to open a centred modal dialog over the world.
 * This replaces the dialog with the interface *changing* — the room the learner
 * is standing in pulls out of focus, takes on the gate's own colour, and the
 * scene assembles on top of it band by band. It is the same screen for all
 * three modes: reading, answering and explaining differ in the body, and in
 * nothing else.
 *
 * Top to bottom: a slim bar (name, progress, XP), the world behind glass, the
 * illustration, the speaker and their line, the body, and one quiet footer hint.
 *
 * ## The background is the world, not a painting
 *
 * There is no full-bleed art in this repo — 16x16 tiles, decor and props, and
 * that is all. So the atmospheric background *is* the live canvas: it keeps
 * running behind the glass, blurred and dimmed and tinted with the portal's own
 * colour from `vocabulary.ts`. Nothing is faked and no asset is invented.
 *
 * Two ways to wire it, and the default is the safe one:
 *
 *  - **omit `backdrop`** and the veil is glass over whatever is already behind
 *    the shell in the DOM. Mounted over the world, that is the running canvas —
 *    and crucially the canvas is never moved in the tree, so it is never
 *    remounted, never reloaded and never resets the player to spawn;
 *  - **pass `backdrop`** to put something specific behind the glass instead.
 *    Whatever is passed must be referentially stable across renders for exactly
 *    the same reason.
 *
 * Where `backdrop-filter` is unsupported, or where nothing is behind the shell
 * at all, the veil is still a flat dim in the gate's colour: a solid-colour
 * fallback with no extra code path. `opaque` forces that case on.
 *
 * ## What it will not do
 *
 * It is presentational. It renders the strings it is handed and never composes
 * one: an absent title, dialogue, caption or hint means that block is absent,
 * not filled in. It has no idea what a portal is for, cannot commit an answer,
 * and nothing it shows may be read as a result.
 */

import { useEffect, useId, useRef } from 'react'
import type { CSSProperties, ReactNode } from 'react'

import type { Actor } from '../../api/types'
import type { PortalKind } from '../types'
import { portalArt } from '../vocabulary'
import { useTypedLine } from './useTypedLine'
import { VnPortrait } from './VnPortrait'
import { VN_CSS, VN_STYLE_HREF } from './vnCss'

/** How much of a run is behind the learner. Both numbers come from the caller. */
export interface VnProgress {
  done: number
  total: number
  /** What one pip counts, for a screen reader. Falls back to a bare count. */
  label?: string
}

/** Who is talking. `name` defaults to the actor's own display name. */
export interface VnSpeaker {
  actor: Actor
  name?: string
}

export interface VisualNovelShellProps {
  /** Which gate this is. Decides every accent colour on the screen. */
  kind: PortalKind
  /**
   * The heading in the top bar — normally the concept's own name, which is the
   * learner's material and safe to show. Never a schema or architecture word.
   */
  title: string
  /** A second line under the title. Omitted when absent. */
  subtitle?: string
  /** Progress pips. Omitted when absent or when `total` is not positive. */
  progress?: VnProgress | null
  /** World XP as the server knows it. `null` shows nothing rather than a zero. */
  xp?: number | null
  /**
   * What sits behind the glass. Omit it to leave the live world showing through
   * untouched — see the note above. Must be referentially stable.
   */
  backdrop?: ReactNode
  /** Paint a solid ground first, for a shell mounted somewhere with no world behind it. */
  opaque?: boolean
  /**
   * The picture above the dialogue. Pass `<SceneIllustration>` built from the
   * scene's own `props`; pass nothing when the scene declared none. The shell
   * never chooses an illustration, because choosing one would be inventing one.
   */
  illustration?: ReactNode
  /** The portrait and name tag beside the line. Omitted when absent. */
  speaker?: VnSpeaker | null
  /** One line of dialogue. Blank or absent omits the whole block. */
  dialogue?: string
  /** Whether that line types itself in. On by default; ignored under reduced motion. */
  typeDialogue?: boolean
  /** The mode-specific body: choices, a page, a conversation. */
  children?: ReactNode
  /** The quiet line along the bottom. Omitted when absent. */
  footerHint?: string
  /** Leaving the portal. Also what `Esc` and the close button call. */
  onClose: () => void
  /** Wording on the close control. */
  closeLabel?: string
}

/** Anything a `Tab` can land on inside the shell. */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** Beyond this a row of pips is a smear, so the count carries it alone. */
const MAX_PIPS = 12

export function VisualNovelShell({
  kind,
  title,
  subtitle,
  progress,
  xp,
  backdrop,
  opaque = false,
  illustration,
  speaker,
  dialogue,
  typeDialogue = true,
  children,
  footerHint,
  onClose,
  closeLabel = 'Leave',
}: VisualNovelShellProps) {
  const art = portalArt(kind)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const titleId = useId()

  // Focus follows the eye, and comes back where it was when the portal closes.
  useEffect(() => {
    const returnTo = document.activeElement
    panelRef.current?.focus()
    return () => {
      if (returnTo instanceof HTMLElement) returnTo.focus()
    }
  }, [])

  // `Esc` closes, and `Tab` stays inside. The listener is on the window rather
  // than the panel because a click on the backdrop moves focus to the body, and
  // an `Esc` that only works while something is focused is not a working `Esc`.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== 'Tab') return
      const root = rootRef.current
      if (!root) return
      const focusable = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (element) => element.offsetParent !== null || element === document.activeElement,
      )
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const active = document.activeElement
      if (!event.shiftKey && active === last) {
        event.preventDefault()
        first.focus()
      } else if (event.shiftKey && (active === first || !root.contains(active))) {
        event.preventDefault()
        last.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const pips = progress && progress.total > 0 ? progress : null
  // An empty field gets no block. Whitespace counts as empty: a line of spaces
  // is a generator artefact, not something the learner was told.
  const line = dialogue && dialogue.trim().length > 0 ? dialogue : null
  const hint = footerHint && footerHint.trim().length > 0 ? footerHint : null

  const veilStyle = {
    '--cq-vn-blur': '9px',
    '--cq-vn-dim': 'rgba(5, 8, 15, 0.64)',
  } as CSSProperties

  return (
    <div ref={rootRef} className="absolute inset-0 z-20">
      <style href={VN_STYLE_HREF} precedence="medium">
        {VN_CSS}
      </style>

      {/* 1. Ground, only where there is nothing behind the shell to look at. */}
      {opaque && <div className="absolute inset-0 bg-background" aria-hidden="true" />}
      {/* 2. Somewhere specific to look, if the caller passed one. */}
      {backdrop && (
        <div className="absolute inset-0 overflow-hidden" aria-hidden="true">
          {backdrop}
        </div>
      )}
      {/* 3. The glass. Nothing above this may carry `opacity`: an ancestor with
             one becomes the backdrop root and the blur quietly stops seeing the
             world — see the layering note in `vnCss.ts`. */}
      <div className="cq-vn-veil absolute inset-0" style={veilStyle} aria-hidden="true" />
      {/* 4. The gate's own light, pooling up from the bottom of the screen. */}
      <div
        className="cq-vn-fade absolute inset-0"
        aria-hidden="true"
        style={{
          background: `radial-gradient(130% 78% at 50% 104%, ${art.glow}, transparent 62%), radial-gradient(90% 55% at 50% -12%, ${art.glow}, transparent 58%)`,
          opacity: 0.55,
        }}
      />
      <div className="cq-vn-scan cq-vn-fade pointer-events-none absolute inset-0 opacity-50" aria-hidden="true" />

      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="absolute inset-0 flex flex-col"
      >
        {/* Top bar: what this is, how far in, what the server has paid. */}
        <header
          className="cq-vn-drop flex items-center gap-4 border-b px-4 py-3 sm:px-8"
          style={{ borderColor: art.glow, backgroundColor: 'rgba(10, 14, 26, 0.55)' }}
        >
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="truncate text-base font-black tracking-tight text-ink sm:text-lg">
              {title}
            </h2>
            {subtitle && <p className="truncate text-xs font-semibold text-ink-muted">{subtitle}</p>}
          </div>

          {pips && (
            <div
              className="flex items-center gap-2"
              aria-label={`${pips.done} of ${pips.total}${pips.label ? ` ${pips.label}` : ''}`}
            >
              {pips.total <= MAX_PIPS && (
                <div className="hidden items-center gap-1.5 sm:flex" aria-hidden="true">
                  {Array.from({ length: pips.total }, (_, i) => {
                    const lit = i < pips.done
                    return (
                      <span
                        key={i}
                        className="h-2 w-2 rounded-full border transition-colors duration-300"
                        style={{
                          backgroundColor: lit ? art.core : 'transparent',
                          borderColor: lit ? art.rim : art.glow,
                          boxShadow: lit ? `0 0 8px ${art.glow}` : undefined,
                        }}
                      />
                    )
                  })}
                </div>
              )}
              <span className="font-hud text-[11px] text-ink-muted" aria-hidden="true">
                {pips.done}/{pips.total}
              </span>
            </div>
          )}

          {typeof xp === 'number' && (
            <span
              className="rounded-full border border-primary/35 bg-primary/10 px-3 py-1 font-hud text-[11px] text-primary-soft"
              aria-label={`${xp} experience points in this world`}
              aria-live="polite"
            >
              {xp} XP
            </span>
          )}

          <button type="button" className="button-secondary" onClick={onClose}>
            {closeLabel}
          </button>
        </header>

        {/* The scene. `tabIndex={-1}` so focus can be parked here on entry
            without adding a stop to the tab order. */}
        <div
          ref={panelRef}
          tabIndex={-1}
          className="min-h-0 flex-1 overflow-y-auto outline-none"
        >
          <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-6 sm:px-8">
            {illustration && (
              <div className="cq-vn-rise" style={{ '--cq-vn-delay': '80ms' } as CSSProperties}>
                {illustration}
              </div>
            )}

            {(speaker || line) && (
              <div
                className="cq-vn-rise flex flex-wrap items-end gap-4 sm:flex-nowrap"
                style={{ '--cq-vn-delay': '150ms' } as CSSProperties}
              >
                {speaker && <VnPortrait actor={speaker.actor} name={speaker.name} kind={kind} />}
                {line && <VnLine text={line} accent={art.rim} typed={typeDialogue} />}
              </div>
            )}

            {children && (
              <div className="cq-vn-rise" style={{ '--cq-vn-delay': '220ms' } as CSSProperties}>
                {children}
              </div>
            )}
          </div>
        </div>

        {hint && (
          <footer
            className="cq-vn-fade border-t px-4 py-3 text-center text-xs font-semibold text-ink-muted sm:px-8"
            style={{ borderColor: art.glow, backgroundColor: 'rgba(10, 14, 26, 0.55)' }}
          >
            {hint}
          </footer>
        )}
      </section>
    </div>
  )
}

/**
 * The spoken line.
 *
 * Its own component so the reveal re-renders a paragraph and not the screen —
 * and so the finished text is always in the DOM for a screen reader, whatever
 * the animation is doing. `aria-live` is deliberately absent: the line is
 * already inside a dialog that just took focus.
 */
function VnLine({ text, accent, typed }: { text: string; accent: string; typed: boolean }) {
  const shown = useTypedLine(text, typed)

  return (
    <p
      className="min-w-0 flex-1 rounded-xl rounded-bl-sm border-l-2 bg-[rgba(13,18,32,0.82)] px-5 py-4 text-base leading-7 text-ink sm:text-lg"
      style={{ borderColor: accent }}
    >
      {shown}
      {shown.length < text.length && <span className="sr-only">{text.slice(shown.length)}</span>}
    </p>
  )
}
