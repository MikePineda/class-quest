import type { JSX } from 'react'

import { useCohort } from '../scene/cohort/useCohort'
import { cohortReadiness, MIN_COHORT_ANSWERS, type CohortReadiness } from './cohortReadiness'

interface CohortStatusCardProps {
  serverId: string
}

export function CohortStatusCard({ serverId }: CohortStatusCardProps): JSX.Element {
  const { cohort, loading } = useCohort(serverId)
  const readiness: 'loading' | CohortReadiness = loading ? 'loading' : cohortReadiness(cohort)

  const status = {
    loading: {
      label: 'Checking cohort…',
      detail: 'Looking for shared answers from this server.',
      tone: 'text-ink-muted',
    },
    unavailable: {
      label: 'Cohort status unavailable',
      detail: 'You can still enter the learning world normally.',
      tone: 'text-ink-muted',
    },
    waiting: {
      label: 'Waiting for a clear class pattern',
      detail: `${cohort?.predictions_made ?? 0} answers recorded · needs at least ${MIN_COHORT_ANSWERS} on one idea`,
      tone: 'text-primary-soft',
    },
    ready: {
      label: 'Challenge ready',
      detail: `${cohort?.members_count ?? 0} members · ${cohort?.predictions_made ?? 0} answers recorded`,
      tone: 'text-secondary',
    },
  }[readiness]

  return (
    <div className="mt-4 rounded-lg border border-primary/20 bg-background/45 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-black uppercase tracking-[0.12em] text-primary-soft">Cohort challenge</p>
          <p className={`mt-1 text-sm font-bold ${status.tone}`}>{status.label}</p>
          <p className="mt-1 text-xs leading-5 text-ink-muted">{status.detail}</p>
        </div>
        <span className="shrink-0 rounded-full border border-white/15 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.1em] text-ink-muted">
          Shared signal
        </span>
      </div>
    </div>
  )
}
