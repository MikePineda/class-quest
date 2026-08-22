import type { CourseGraph } from '../api/types'

interface ConceptTrailProps {
  graph: CourseGraph
  activeConceptId: string
  recovered: boolean
}

export function ConceptTrail({ graph, activeConceptId, recovered }: ConceptTrailProps) {
  const activeConcept = graph.concepts.find((concept) => concept.id === activeConceptId)
  const foundations = new Set(activeConcept?.prerequisites ?? [])

  return (
    <aside className="cq-panel bg-surface/85 p-5 backdrop-blur sm:p-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="eyebrow">Concept trail</p>
          <h2 className="mt-2 text-lg font-bold">Recovery map</h2>
        </div>
        <span className={`status-dot ${recovered ? 'bg-secondary' : 'bg-primary'}`} aria-hidden="true" />
      </div>

      <ol className="mt-6 space-y-1">
        {graph.concepts.map((concept) => {
          const isActive = concept.id === activeConceptId
          const isFoundation = foundations.has(concept.id)
          const state = isActive ? (recovered ? 'Recovered' : 'Investigating') : isFoundation ? 'Foundation ready' : 'Locked'

          return (
            <li key={concept.id} className="relative flex gap-3 pb-4 last:pb-0">
              <div className="flex w-6 flex-col items-center">
                <span
                  aria-hidden="true"
                  className={`mt-1.5 h-3 w-3 rounded-full border-2 ${
                    isActive
                      ? recovered
                        ? 'border-secondary bg-secondary'
                        : 'border-primary bg-primary'
                      : isFoundation
                        ? 'border-secondary/70 bg-secondary/20'
                        : 'border-outline/30 bg-surface-high'
                  }`}
                />
                <span className="mt-1 h-full w-px bg-white/10 last:hidden" aria-hidden="true" />
              </div>
              <div className={isActive || isFoundation ? '' : 'opacity-45'}>
                <p className={`font-semibold ${isActive ? 'text-ink' : 'text-ink-muted'}`}>{concept.label}</p>
                <p className={`mt-0.5 text-xs ${isActive ? (recovered ? 'text-secondary' : 'text-primary-soft') : 'text-ink-muted/70'}`}>
                  {state}
                </p>
              </div>
            </li>
          )
        })}
      </ol>

      <div className="mt-6 rounded-xl border border-white/10 bg-background/35 p-4">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ink-muted">Recovery status</p>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface-highest" aria-hidden="true">
          <div className={`h-full rounded-full transition-all duration-500 ${recovered ? 'w-full bg-secondary' : 'w-2/5 bg-primary'}`} />
        </div>
        <p className="mt-2 text-sm font-semibold text-ink">{recovered ? 'Concept restored' : 'Evidence trail in progress'}</p>
      </div>
    </aside>
  )
}
