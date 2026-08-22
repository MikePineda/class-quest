import type {
  Chapter,
  Concept,
  CourseGraph,
  DialogueScene,
  Game,
  Misconception,
  Option,
  PredictionScene,
  SourceSpan,
} from '../api/types'

export interface DemoEncounter {
  chapter: Chapter
  concept: Concept
  intro: DialogueScene | null
  prediction: PredictionScene
  transfer: PredictionScene
  sourceSpan: SourceSpan
  sourceTitle: string
}

export function resolveDemoEncounter(graph: CourseGraph, game: Game): DemoEncounter {
  if (graph.graph_id !== game.graph_id) {
    throw new Error('The learning graph and quest do not belong to the same world.')
  }

  for (const chapter of game.chapters) {
    const predictions = chapter.scenes.filter(
      (scene): scene is PredictionScene => scene.type === 'prediction',
    )
    const prediction = predictions.find((scene, index) =>
      predictions.slice(index + 1).some((candidate) => candidate.concept_id === scene.concept_id),
    )

    if (!prediction) continue

    const transfer = predictions.find(
      (scene) => scene.id !== prediction.id && scene.concept_id === prediction.concept_id,
    )
    const concept = graph.concepts.find((candidate) => candidate.id === prediction.concept_id)
    const intro = chapter.scenes.find((scene): scene is DialogueScene => scene.type === 'dialogue') ?? null

    if (!transfer || !concept) continue

    const sourceSpan = concept.source_spans.at(-1)
    if (!sourceSpan) throw new Error(`No verified source is attached to ${concept.label}.`)

    return {
      chapter,
      concept,
      intro,
      prediction,
      transfer,
      sourceSpan,
      sourceTitle: graph.source.title,
    }
  }

  throw new Error('This quest does not contain a prediction and transfer pair for one concept.')
}

export function findMisconception(concept: Concept, option: Option | undefined): Misconception | null {
  if (!option || option.correct) return null
  return concept.misconceptions.find((item) => item.id === option.misconception_id) ?? null
}
