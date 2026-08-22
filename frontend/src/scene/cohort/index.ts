/**
 * The class, read-only.
 *
 * Everything in here hangs off one endpoint — `GET /servers/{id}/cohort`, keyed
 * by `WorldDetail.server_id` — and none of it may ever gate, award or block
 * anything. It reports; the world decides nothing by it, and a failed request
 * costs the learner a garnish, never the run.
 *
 * - `useCohort` — one shared, cached, non-polling read of the payload.
 * - `CohortEcho` — how the class answered one question, after the learner commits.
 * - `WorldClosurePanel` — the fourth portal: what the run was worth, and the way out.
 * - `cohortStats` — the pure derivations, including every refusal to speak on
 *   thin data. Test that, not the components.
 */

export { CohortEcho } from './CohortEcho'
export type { CohortEchoProps } from './CohortEcho'

export { WorldClosurePanel } from './WorldClosurePanel'
export type { WorldClosurePanelProps } from './WorldClosurePanel'

export { CACHE_MS, useCohort } from './useCohort'
export type { CohortState } from './useCohort'

export {
  DEFAULT_BOARD_ROWS,
  MIN_CLASS_PLAYERS,
  MIN_ECHO_ANSWERS,
  classSnapshot,
  masterySummary,
  sceneEcho,
} from './cohortStats'
export type {
  BoardRow,
  ClassSnapshot,
  ClassTrap,
  EchoOption,
  MasterySummary,
  SceneEcho,
} from './cohortStats'
