/**
 * Plain copies of /fixtures/*.json (repo root). They let the renderer be built
 * offline: `quest` and `gauntlet` are two games from the same `graph`
 * (shared `graph_id: "wk3ml0a1"`). Same shapes as `WorldDetail.graph` and
 * `WorldDetail.games.{quest,gauntlet}`.
 */
import type { CourseGraph, Game } from '../api/types'
import graphJson from './overfitting.graph.json'
import questJson from './overfitting.quest.json'
import gauntletJson from './overfitting.gauntlet.json'

export const fixtureGraph = graphJson as CourseGraph
export const fixtureQuest = questJson as Game
export const fixtureGauntlet = gauntletJson as Game

export const fixtures = { graph: fixtureGraph, quest: fixtureQuest, gauntlet: fixtureGauntlet }
