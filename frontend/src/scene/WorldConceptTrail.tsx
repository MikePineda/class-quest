import type { JSX } from 'react'
import type { ConceptProgress } from './pedagogy'

export interface WorldConceptTrailProps {
  trail: ConceptProgress[]
  /** The concept the player is standing in front of right now, if any. */
  activeConceptId?: string | null
}

const STATE_LABEL: Record<ConceptProgress['state'], string> = {
  mastered: 'Mastered',
  in_progress: 'In progress',
  available: 'Ready to explore',
  locked: 'Locked',
}

/** Dot styling per state: filled for done, hollow for reachable, faded for gated. */
const STATE_DOT: Record<ConceptProgress['state'], string> = {
  mastered: 'border-secondary bg-secondary',
  in_progress: 'border-primary bg-primary/40',
  available: 'border-secondary/70 bg-secondary/15',
  locked: 'border-outline/30 bg-surface-high',
}

const STATE_TEXT: Record<ConceptProgress['state'], string> = {
  mastered: 'text-secondary',
  in_progress: 'text-primary-soft',
  available: 'text-ink-muted',
  locked: 'text-ink-muted/70',
}

function progressLabel(entry: ConceptProgress): string {
  if (entry.total <= 0) return 'No scenes yet'
  return `${entry.done} / ${entry.total} scenes`
}

/** Prerequisites that are still holding this concept back, by label when we know it. */
function blockingPrerequisites(entry: ConceptProgress, byId: Map<string, ConceptProgress>): string[] {
  return entry.concept.prerequisites
    .map((id) => byId.get(id))
    .filter((prerequisite) => prerequisite !== undefined && prerequisite.state !== 'mastered')
    .map((prerequisite) => prerequisite.concept.label)
}

export function WorldConceptTrail({ trail, activeConceptId }: WorldConceptTrailProps): JSX.Element {
  const byId = new Map(trail.map((entry) => [entry.concept.id, entry]))
  const masteredCount = trail.filter((entry) => entry.state === 'mastered').length
  const masteredPercent = trail.length > 0 ? Math.round((masteredCount / trail.length) * 100) : 0

  return (
    <aside
      aria-label="Concept trail"
      className="w-full rounded-2xl border border-white/10 bg-surface p-4 shadow-2xl shadow-black/50"
    >
      <div className="flex items-baseline justify-between gap-3">
        <p className="eyebrow">Concept trail</p>
        <p className="text-xs font-semibold text-ink-muted">
          <span className="text-ink">{masteredCount}</span> / {trail.length} mastered
        </p>
      </div>

      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-highest" aria-hidden="true">
        <div
          className="h-full rounded-full bg-secondary transition-all duration-500"
          style={{ width: `${masteredPercent}%` }}
        />
      </div>

      {trail.length === 0 ? (
        <p className="mt-4 text-xs text-ink-muted">No concepts mapped for this world yet.</p>
      ) : (
        <ol className="mt-4 max-h-72 space-y-0.5 overflow-y-auto pr-1">
          {trail.map((entry, index) => {
            const isActive = entry.concept.id === activeConceptId
            const isLast = index === trail.length - 1
            const blockers = entry.state === 'locked' ? blockingPrerequisites(entry, byId) : []

            return (
              <li key={entry.concept.id} className="relative">
                {!isLast && (
                  <span
                    aria-hidden="true"
                    className="absolute left-[0.9rem] top-6 h-[calc(100%-1rem)] w-px bg-white/10"
                  />
                )}
                <div
                  aria-current={isActive ? 'step' : undefined}
                  className={`relative flex items-start gap-2.5 rounded-xl px-2 py-1.5 ${
                    isActive ? 'bg-surface-high ring-1 ring-primary/50' : ''
                  } ${entry.state === 'locked' ? 'opacity-55' : ''}`}
                >
                  <span
                    aria-hidden="true"
                    className={`mt-1 h-3 w-3 shrink-0 rounded-full border-2 ${STATE_DOT[entry.state]}`}
                  />
                  <div className="min-w-0 flex-1">
                    <p className={`truncate text-sm font-semibold ${isActive ? 'text-ink' : 'text-ink-muted'}`}>
                      {entry.concept.label}
                    </p>
                    <p className="mt-0.5 text-[0.7rem] leading-tight">
                      <span className={`font-bold ${STATE_TEXT[entry.state]}`}>{STATE_LABEL[entry.state]}</span>
                      <span className="text-ink-muted/60"> · {progressLabel(entry)}</span>
                    </p>
                    {entry.state === 'locked' && (
                      <p className="mt-0.5 text-[0.7rem] leading-tight text-ink-muted/70">
                        {blockers.length > 0 ? `Needs ${blockers.join(', ')}` : 'Needs an earlier concept'}
                      </p>
                    )}
                  </div>
                  {isActive && (
                    <span className="mt-0.5 shrink-0 rounded-lg bg-primary/20 px-1.5 py-0.5 text-[0.6rem] font-extrabold uppercase tracking-[0.12em] text-primary-soft">
                      Here
                    </span>
                  )}
                </div>
              </li>
            )
          })}
        </ol>
      )}
    </aside>
  )
}
