/**
 * The way out. One component, on every screen.
 *
 * The rule it exists to enforce: **a screen that can be rendered may not be
 * rendered without an anchor to somewhere else.** Several screens used to
 * break it — the scripted demo had no links at all, and the world's loading
 * state parked a learner forever if the fetch hung — and the browser's back
 * button was the only way out of any of them.
 *
 * Deliberately an anchor to a named destination, never `history.back()`:
 * from a deep link Back leaves the app entirely, and a control that says
 * where it goes is the only kind a first-time viewer can trust.
 */
import type { ReactNode } from 'react'

export interface BackLinkProps {
  /** Where to. A real path, so the link is real. */
  to: string
  children: ReactNode
  /** `button` for an empty state that needs a target; `inline` for a header. */
  variant?: 'inline' | 'button'
  className?: string
}

const INLINE =
  'inline-flex min-h-11 items-center gap-2 rounded-lg px-2 text-sm font-bold text-ink-muted transition hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary focus-visible:ring-offset-2 focus-visible:ring-offset-background'

export function BackLink({ to, children, variant = 'inline', className = '' }: BackLinkProps) {
  const base = variant === 'button' ? 'button-secondary' : INLINE
  return (
    <a className={`${base} ${className}`.trim()} href={to}>
      <span aria-hidden="true">←</span>
      {children}
    </a>
  )
}
