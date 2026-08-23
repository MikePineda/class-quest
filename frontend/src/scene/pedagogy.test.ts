/**
 * These tests are the pedagogical claim, written down.
 *
 * Two failure modes matter more than the happy path. The first is a diagnosis
 * that degrades into the generic reveal — the learner is told "here is the
 * answer" instead of "here is the belief you hold". The second is a throw: the
 * inputs are HTTP payloads, and an exception here blanks the world mid-scene.
 * Every case below pins one or the other.
 */

import { describe, expect, it } from 'vitest'

import type { AttemptOut, CourseGraph, Game, Option, PredictionScene, Scene } from '../api/types'
import { fixtureGraph, fixtureQuest } from '../fixtures'
import { conceptTrail, diagnose } from './pedagogy'

/** Scenes are nested two deep; every test needs one by id. */
function sceneById(game: Game, id: string): Scene {
  for (const chapter of game.chapters) {
    for (const scene of chapter.scenes) {
      if (scene.id === id) return scene
    }
  }
  throw new Error(`fixture is missing scene ${id}`)
}

const prediction = (id: string): PredictionScene => {
  const scene = sceneById(fixtureQuest, id)
  if (scene.type !== 'prediction') throw new Error(`${id} is not a prediction scene`)
  return scene
}

const optionById = (scene: PredictionScene, id: string): Option => {
  const option = scene.options.find((candidate) => candidate.id === id)
  if (!option) throw new Error(`scene ${scene.id} has no option ${id}`)
  return option
}

/** An `AttemptOut` is wide; tests only ever care about three of its fields. */
const verdictOf = (patch: Partial<AttemptOut>): AttemptOut => ({
  attempt_id: 'at_1',
  correct: false,
  xp_awarded: 0,
  first_time: false,
  misconception: null,
  reveal: '',
  world_xp: 0,
  server_xp: 0,
  ...patch,
})

const overfitScene = prediction('sc_pred_overfit')
const wrongOption = optionById(overfitScene, 'op_same')
const rightOption = optionById(overfitScene, 'op_worse')

/**
 * A two-concept graph modelled on real generated content: the classification
 * scene offers a distractor that the graph files under `regression`.
 */
const boundaryGraph: CourseGraph = {
  schema_version: '1.0',
  graph_id: 'boundary1',
  source: { title: 'Intro to Machine Learning, Week 1', segment_count: 4 },
  concepts: [
    {
      id: 'classification',
      label: 'Classification',
      summary: 'Predicting which class an input belongs to.',
      bloom_level: 'understand',
      prerequisites: [],
      source_spans: [{ segment_id: 1, quote: 'A classifier assigns each input a discrete label.' }],
      misconceptions: [
        {
          id: 'classification_outputs_probability',
          statement: 'A classifier outputs a probability, not a class.',
          why_plausible: 'Most libraries expose scores before the argmax, so the scores look like the output.',
          correction: 'The scores are intermediate. The prediction is the class the model commits to.',
        },
      ],
    },
    {
      id: 'regression',
      label: 'Regression',
      summary: 'Predicting a continuous quantity.',
      bloom_level: 'understand',
      prerequisites: ['classification'],
      source_spans: [{ segment_id: 2, quote: 'Regression predicts a continuous quantity.' }],
      misconceptions: [
        {
          id: 'regression_is_just_classification_with_numbers',
          statement: 'Regression is just classification with numbers.',
          why_plausible: 'Both map an input to an output with the same fitting machinery, so the difference looks cosmetic.',
          correction: 'A regressor predicts a continuous quantity, so its errors have magnitude and its classes do not exist.',
        },
      ],
    },
  ],
}

const classifyScene: PredictionScene = {
  type: 'prediction',
  id: 'sc_pred_classify',
  concept_id: 'classification',
  prompt: 'The model must label an email spam or not spam. What is it doing?',
  options: [
    { id: 'op_class', text: 'Choosing between two classes', correct: true },
    {
      id: 'op_numbers',
      text: 'Predicting a number and rounding it',
      correct: false,
      misconception_id: 'regression_is_just_classification_with_numbers',
    },
  ],
  reveal: 'It commits to one of two classes.',
}

const boundaryOption = optionById(classifyScene, 'op_numbers')

describe('diagnose', () => {
  it('names the wrong belief with all three of its parts and the source quote', () => {
    const d = diagnose(fixtureGraph, overfitScene, wrongOption)

    expect(d.correct).toBe(false)
    expect(d.concept?.id).toBe('overfitting')
    expect(d.misconception?.id).toBe('high_train_high_test')
    // The whole point: statement, why it was tempting, and what is true.
    expect(d.misconception?.statement).toMatch(/99 percent/)
    expect(d.misconception?.why_plausible).toMatch(/looks exactly like progress/)
    expect(d.misconception?.correction).toMatch(/decouple/)
    // Evidence is verbatim course material, not generated prose.
    expect(d.evidence).toEqual({
      segment_id: 5,
      quote: 'Overfitting occurs when a model fits noise in the training data rather than the underlying signal.',
    })
    expect(d.sourceTitle).toBe('Intro to Machine Learning, Week 3')
    expect(d.reveal).toBe(overfitScene.reveal)
  })

  it('diagnoses nothing when the learner was right', () => {
    const d = diagnose(fixtureGraph, overfitScene, rightOption)

    expect(d.correct).toBe(true)
    expect(d.misconception).toBeNull()
    // Concept and evidence still resolve: being right is worth grounding too.
    expect(d.concept?.id).toBe('overfitting')
    expect(d.evidence?.segment_id).toBe(5)
  })

  it('lets the server overrule a locally-correct-looking option', () => {
    const d = diagnose(
      fixtureGraph,
      overfitScene,
      rightOption,
      verdictOf({
        correct: false,
        misconception: {
          id: 'high_train_high_test',
          statement: 'server statement',
          correction: 'server correction',
        },
      }),
    )

    expect(d.correct).toBe(false)
    // Graph copy wins over the wire copy, because only it carries why_plausible.
    expect(d.misconception?.why_plausible).toMatch(/looks exactly like progress/)
    expect(d.misconception?.statement).not.toBe('server statement')
  })

  it('lets the server overrule a locally-wrong-looking option', () => {
    const d = diagnose(fixtureGraph, overfitScene, wrongOption, verdictOf({ correct: true }))

    expect(d.correct).toBe(true)
    expect(d.misconception).toBeNull()
  })

  it("prefers the server's reveal, and falls back to the scene's when it is empty", () => {
    const served = diagnose(
      fixtureGraph,
      overfitScene,
      rightOption,
      verdictOf({ correct: true, reveal: 'graded server-side' }),
    )
    expect(served.reveal).toBe('graded server-side')

    const empty = diagnose(fixtureGraph, overfitScene, rightOption, verdictOf({ correct: true, reveal: '  ' }))
    expect(empty.reveal).toBe(overfitScene.reveal)
  })

  it('degrades to nulls when there is no graph', () => {
    const d = diagnose(null, overfitScene, wrongOption)

    expect(d.correct).toBe(false)
    expect(d.concept).toBeNull()
    expect(d.misconception).toBeNull()
    expect(d.evidence).toBeNull()
    expect(d.sourceTitle).toBeNull()
    // The generic reveal survives: something teachable is always shown.
    expect(d.reveal).toBe(overfitScene.reveal)
  })

  it('degrades to nulls when the scene points at a concept the graph does not have', () => {
    const orphan: PredictionScene = { ...overfitScene, concept_id: 'no_such_concept' }
    const d = diagnose(fixtureGraph, orphan, wrongOption)

    expect(d.concept).toBeNull()
    expect(d.evidence).toBeNull()
    // The graph is still there, so the citation title is still known, and the
    // belief still resolves: it is looked up graph-wide, not under the concept.
    expect(d.sourceTitle).toBe('Intro to Machine Learning, Week 3')
    expect(d.misconception?.id).toBe('high_train_high_test')
  })

  it('degrades to null when the option points at a misconception the graph does not have', () => {
    const stray: Option = { id: 'op_stray', text: 'stray', correct: false, misconception_id: 'no_such_belief' }
    const d = diagnose(fixtureGraph, overfitScene, stray)

    expect(d.concept?.id).toBe('overfitting')
    expect(d.misconception).toBeNull()
    expect(d.evidence?.segment_id).toBe(5)
  })

  it('resolves a distractor owned by a neighbouring concept', () => {
    // A boundary confusion: the belief belongs to `regression`, but the scene it
    // is offered on teaches `classification`. The schema promises only that the
    // id resolves *in the graph*, and these cross-concept distractors are the
    // most diagnostic ones the planner writes, so they must not be discarded.
    const d = diagnose(boundaryGraph, classifyScene, boundaryOption)

    expect(d.misconception?.id).toBe('regression_is_just_classification_with_numbers')
    expect(d.misconception?.statement).toBe('Regression is just classification with numbers.')
    expect(d.misconception?.why_plausible).toMatch(/same fitting machinery/)
    expect(d.misconception?.correction).toMatch(/continuous quantity/)
    // Grounding stays with the scene's own concept, so quote and reveal agree.
    expect(d.concept?.id).toBe('classification')
    expect(d.evidence?.quote).toMatch(/discrete label/)
  })

  it('still diagnoses from the verdict alone, without inventing why_plausible', () => {
    const d = diagnose(
      null,
      overfitScene,
      wrongOption,
      verdictOf({
        correct: false,
        misconception: {
          id: 'high_train_high_test',
          statement: '99 percent on training means roughly 99 percent on new data.',
          correction: 'The two scores decouple once the model starts fitting noise.',
        },
      }),
    )

    expect(d.misconception?.id).toBe('high_train_high_test')
    expect(d.misconception?.statement).toMatch(/99 percent/)
    expect(d.misconception?.correction).toMatch(/decouple/)
    // Empty, never fabricated: the client has no grounded copy to write.
    expect(d.misconception?.why_plausible).toBe('')
    expect(d.evidence).toBeNull()
  })

  it('never throws on a dialogue scene, which teaches no concept and has no reveal', () => {
    const dialogue = sceneById(fixtureQuest, 'sc_open')
    const d = diagnose(fixtureGraph, dialogue, wrongOption)

    expect(d.concept).toBeNull()
    expect(d.evidence).toBeNull()
    expect(d.reveal).toBe('')
    // The belief is still found, since the lookup never needed the concept.
    expect(d.misconception?.id).toBe('high_train_high_test')
  })
})

// ---------------------------------------------------------------------------

/** Ids of every scene in the fixture quest that carries a concept. */
const TRAINING_SCENES = ['sc_pred_training']
const OVERFIT_SCENES = ['sc_pred_overfit', 'sc_sim_curve', 'sc_transfer_overfit']

const trail = (done: string[], correct?: string[], game: Game = fixtureQuest) =>
  conceptTrail(fixtureGraph, game, new Set(done), correct && new Set(correct))

const byId = (rows: ReturnType<typeof trail>, id: string) => {
  const row = rows.find((r) => r.concept.id === id)
  if (!row) throw new Error(`trail is missing ${id}`)
  return row
}

describe('conceptTrail', () => {
  it('keeps the graph order and lists concepts the game never covers', () => {
    const rows = trail([])

    expect(rows.map((r) => r.concept.id)).toEqual([
      'training_data',
      'generalisation',
      'overfitting',
      'validation_split',
      'regularisation',
    ])
    // The quest covers two of the five; the other three are still on the trail.
    expect(byId(rows, 'generalisation').total).toBe(0)
    expect(byId(rows, 'validation_split').total).toBe(0)
  })

  it('counts only scenes that carry a concept_id, never dialogue', () => {
    const rows = trail([])

    expect(byId(rows, 'training_data').total).toBe(TRAINING_SCENES.length)
    // Two predictions and a simulation; the two dialogue scenes are not counted.
    expect(byId(rows, 'overfitting').total).toBe(OVERFIT_SCENES.length)
  })

  it('ignores completed dialogue scenes when counting progress', () => {
    const rows = trail(['sc_open', 'sc_doors'])

    expect(byId(rows, 'training_data').done).toBe(0)
    expect(byId(rows, 'overfitting').done).toBe(0)
    expect(byId(rows, 'training_data').state).toBe('available')
  })

  it('masters a concept only once every one of its scenes is done', () => {
    const partial = trail(OVERFIT_SCENES.slice(0, 2))
    expect(byId(partial, 'overfitting').done).toBe(2)
    expect(byId(partial, 'overfitting').state).toBe('in_progress')

    const full = trail(OVERFIT_SCENES)
    expect(byId(full, 'overfitting').done).toBe(3)
    expect(byId(full, 'overfitting').state).toBe('mastered')
  })

  it('locks a concept until a prerequisite this game teaches is mastered', () => {
    // `generalisation` requires `training_data`, whose single scene is unfinished.
    expect(byId(trail([]), 'generalisation').state).toBe('locked')
    // Same gate, reached from `overfitting`, which also requires `training_data`.
    expect(byId(trail([]), 'overfitting').state).toBe('locked')

    const after = trail(TRAINING_SCENES)
    expect(byId(after, 'training_data').state).toBe('mastered')
    expect(byId(after, 'generalisation').state).toBe('available')
  })

  it('does not gate on a prerequisite this game never teaches', () => {
    // `overfitting` requires `training_data` (mastered here) and `generalisation`,
    // which this quest has no scenes for. Gating on the latter would be a lock the
    // learner could never open from inside this world, so it counts as satisfied.
    const rows = trail(TRAINING_SCENES)

    expect(byId(rows, 'generalisation').total).toBe(0)
    expect(byId(rows, 'generalisation').state).toBe('available')
    expect(byId(rows, 'overfitting').done).toBe(0)
    expect(byId(rows, 'overfitting').state).toBe('available')
  })

  it('never claims mastery for a concept this game does not teach', () => {
    // The permissive gate is in the gate, not in the state: `total === 0` earns
    // `available`, never `mastered`, however much of the game is finished.
    const rows = trail([...TRAINING_SCENES, ...OVERFIT_SCENES])

    expect(rows.filter((r) => r.total === 0).map((r) => r.state)).toEqual([
      'available',
      'available',
      'available',
    ])
  })

  it('never locks a concept the learner has already started', () => {
    expect(byId(trail([]), 'overfitting').state).toBe('locked')
    expect(byId(trail([OVERFIT_SCENES[0]]), 'overfitting').state).toBe('in_progress')
  })

  it('ignores prerequisite ids the graph does not contain instead of locking on them', () => {
    const patched = {
      ...fixtureGraph,
      concepts: fixtureGraph.concepts.map((concept) =>
        concept.id === 'training_data' ? { ...concept, prerequisites: ['ghost_concept'] } : concept,
      ),
    }

    expect(conceptTrail(patched, fixtureQuest, new Set()).find((r) => r.concept.id === 'training_data')?.state)
      .toBe('available')
  })

  it('does not master a concept the learner walked through but answered wrong', () => {
    // Every overfitting scene visited, not one prediction right.
    const rows = trail(OVERFIT_SCENES, [])

    expect(byId(rows, 'overfitting').done).toBe(3)
    expect(byId(rows, 'overfitting').state).toBe('in_progress')
    // Without a correct-set the caller has no verdicts to offer, so the old
    // walked-it-all meaning is kept and this same progress reads as mastery.
    expect(byId(trail(OVERFIT_SCENES), 'overfitting').state).toBe('mastered')
  })

  it('masters a concept once every prediction for it was answered correctly', () => {
    // `sc_sim_curve` is a simulation: there is nothing to get wrong, so mastery
    // asks only about the two predictions.
    const rows = trail(OVERFIT_SCENES, ['sc_pred_overfit', 'sc_transfer_overfit'])

    expect(byId(rows, 'overfitting').state).toBe('mastered')
    // One prediction right and the other still open is not mastery either.
    expect(byId(trail(OVERFIT_SCENES, ['sc_pred_overfit']), 'overfitting').state).toBe('in_progress')
  })

  it('keeps a concept locked while its prerequisite was answered wrong', () => {
    const wrong = trail(TRAINING_SCENES, [])
    expect(byId(wrong, 'training_data').state).toBe('in_progress')
    expect(byId(wrong, 'generalisation').state).toBe('locked')

    const right = trail(TRAINING_SCENES, TRAINING_SCENES)
    expect(byId(right, 'training_data').state).toBe('mastered')
    expect(byId(right, 'generalisation').state).toBe('available')
  })

  it('returns an empty trail without a graph, and never throws on an empty game', () => {
    expect(conceptTrail(null, fixtureQuest, new Set())).toEqual([])

    const emptyGame: Game = { ...fixtureQuest, chapters: [] }
    const rows = conceptTrail(fixtureGraph, emptyGame, new Set())
    expect(rows).toHaveLength(5)
    expect(rows.every((r) => r.total === 0 && r.done === 0)).toBe(true)
  })
})
