/**
 * The row of numbered choices along the bottom of the novel.
 *
 * Presentational, and deliberately half a mechanism: it *selects*, and it has
 * no idea how to commit. Locking in an answer is a separate, deliberate act —
 * revealing on selection turns the whole thing back into an ordinary quiz — so
 * the commit button belongs to whichever body owns the question, and this
 * component never grows an `onCommit`.
 *
 * The number keys follow the same rule. `1`, `2`, `3` move the selection and
 * stop there; nothing on this keyboard path can ever post an answer.
 */

import { useEffect } from 'react'

import type { PortalKind } from '../types'
import { portalArt } from '../vocabulary'

/** How a choice should look. Set by the body once the answer is out, never decided here. */
export type VnChoiceTone = 'neutral' | 'correct' | 'incorrect' | 'muted'

export interface VnChoice {
  id: string
  text: string
  tone?: VnChoiceTone
}

export interface VnChoiceRowProps {
  /** Which portal's light the row is lit by. */
  kind: PortalKind
  choices: readonly VnChoice[]
  /** The current selection, or null for none. Owned by the caller. */
  selectedId: string | null
  onSelect: (id: string) => void
  /**
   * No further selection is possible — the answer is committed and out. The
   * tones still render, so the row keeps teaching after it stops accepting.
   */
  locked?: boolean
  /**
   * A heading above the row. Omitted when absent: an empty field gets no block
   * rather than invented copy.
   */
  label?: string
  /**
   * Whether `1`..`9` move the selection. Off where digits mean something else —
   * a body with a text box of its own, for instance.
   */
  numberKeys?: boolean
  className?: string
}

/** Digits only, and only when the learner is not typing into something. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  if (target.closest('input, textarea, select')) return true
  return target instanceof HTMLElement && target.isContentEditable
}

export function VnChoiceRow({
  kind,
  choices,
  selectedId,
  onSelect,
  locked = false,
  label,
  numberKeys = true,
  className,
}: VnChoiceRowProps) {
  const art = portalArt(kind)

  useEffect(() => {
    if (!numberKeys || locked) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return
      if (isTypingTarget(event.target)) return
      // `event.key` rather than a code, so the top row and the numpad both work
      // and a non-QWERTY layout still gets the digit it printed.
      const index = Number.parseInt(event.key, 10) - 1
      if (!Number.isInteger(index) || index < 0 || index >= choices.length) return
      event.preventDefault()
      // Selection only. There is no key on this component that commits.
      onSelect(choices[index].id)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [choices, locked, numberKeys, onSelect])

  if (choices.length === 0) return null

  return (
    <div className={className}>
      {label && <p className="eyebrow mb-2 text-ink-muted">{label}</p>}
      {/* A row while the choices fit on one, wrapping to a stack when they do
          not: a three-word answer and a two-line one both have to work. */}
      <div className="flex flex-wrap gap-3" role="group" aria-label={label ?? 'Choices'}>
        {choices.map((choice, index) => {
          const chosen = choice.id === selectedId
          const tone = choice.tone ?? 'neutral'
          const accent =
            tone === 'correct' ? '#43d9c4' : tone === 'incorrect' ? '#ff8f86' : chosen ? art.rim : undefined

          return (
            <button
              key={choice.id}
              type="button"
              onClick={() => onSelect(choice.id)}
              disabled={locked && !chosen && tone === 'neutral'}
              aria-pressed={chosen}
              aria-keyshortcuts={numberKeys && index < 9 ? String(index + 1) : undefined}
              className={`answer-choice flex min-w-[15rem] flex-1 items-center gap-3 rounded-xl border px-4 py-3 text-left transition ${
                tone === 'muted' ? 'opacity-55' : ''
              } ${accent ? '' : 'border-white/12 bg-surface-high hover:border-white/25 hover:bg-surface-highest'}`}
              style={
                accent
                  ? {
                      borderColor: accent,
                      backgroundColor: 'rgba(255, 255, 255, 0.04)',
                      boxShadow: chosen ? `0 0 0 1px ${accent}, 0 0 18px ${art.glow}` : undefined,
                    }
                  : undefined
              }
            >
              <span
                aria-hidden="true"
                className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border font-hud text-xs"
                style={{
                  borderColor: accent ?? 'rgba(255, 255, 255, 0.15)',
                  backgroundColor: chosen ? accent ?? art.rim : 'rgba(10, 14, 26, 0.55)',
                  color: chosen ? '#0a0e1a' : '#8f9ac0',
                }}
              >
                {index + 1}
              </span>
              <span className="text-sm font-semibold leading-6 text-ink">{choice.text}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
