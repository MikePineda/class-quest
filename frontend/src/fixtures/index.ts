/**
 * Plain copies of /fixtures/*.json (repo root), compiled into the page.
 *
 * They are what makes the app walkable with no API and no account: the login
 * screen's "Walk the demo world" opens one of these, and the world screen's
 * error paths offer them when the network is not cooperating. Each bundle is a
 * `graph` plus two games built from it, sharing one `graph_id` — the same
 * shapes as `WorldDetail.graph` and `WorldDetail.games.{quest,gauntlet}`.
 *
 * Keep these byte-identical to /fixtures: `scripts/check-fixtures-sync.sh`
 * fails CI otherwise, and `npm run sync:fixtures` recopies them.
 */
import type { CourseGraph, Game } from '../api/types'
import type { FixtureBundle } from '../nav/routes'
import overfittingGraph from './overfitting.graph.json'
import overfittingQuest from './overfitting.quest.json'
import overfittingGauntlet from './overfitting.gauntlet.json'
import pybasicsGraph from './pybasics.graph.json'
import pybasicsQuest from './pybasics.quest.json'
import pybasicsGauntlet from './pybasics.gauntlet.json'

export interface Bundle {
  graph: CourseGraph
  quest: Game
  gauntlet: Game
}

export const bundles: Record<FixtureBundle, Bundle> = {
  pybasics: {
    graph: pybasicsGraph as CourseGraph,
    quest: pybasicsQuest as Game,
    gauntlet: pybasicsGauntlet as Game,
  },
  overfitting: {
    graph: overfittingGraph as CourseGraph,
    quest: overfittingQuest as Game,
    gauntlet: overfittingGauntlet as Game,
  },
}

export const bundleOf = (name: FixtureBundle): Bundle => bundles[name]

/**
 * The original ML fixture, under the names it has had since the contract was
 * written. The demo reducer in `src/demo/` still reads these directly.
 */
export const fixtureGraph = bundles.overfitting.graph
export const fixtureQuest = bundles.overfitting.quest
export const fixtureGauntlet = bundles.overfitting.gauntlet

export const fixtures = bundles.overfitting
