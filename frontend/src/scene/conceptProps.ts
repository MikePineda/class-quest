/**
 * Which props illustrate a question.
 *
 * ## Why this module exists
 *
 * `SceneIllustration` draws the props a scene declared, and `chart_frame` is a
 * real plotted curve rather than a sprite. But **no gauntlet scene in any
 * generated world declares a prop**: measured across every world on the
 * deployed server, props appear only on quest scenes. The quest is not walkable
 * since the hub redesign, so every prop the model ever chose is unreachable and
 * every question renders without an illustration.
 *
 * ## What this does, and the line it does not cross
 *
 * A question is about one concept. If the model, reading the learner's own
 * material, decided that concept was worth drawing a curve beside — it declared
 * `chart_frame` on that concept's quest scene — then the question about that
 * same concept inherits it.
 *
 * The judgement "this idea deserves a picture, and that picture is a plotted
 * curve" is the model's, made from the source material. What is ours is
 * carrying it from one scene to another scene about the same concept. That is
 * the whole liberty taken, and it is deliberately the smallest one available:
 *
 * - a concept with no illustrated quest scene gets **no illustration**, never a
 *   decorative stand-in
 * - props are never mixed across concepts
 * - a scene that declares its own props always wins; nothing is overridden
 *
 * Pure, total, and never throws: it runs while the world renders.
 */
import type { Game, Prop, Scene } from '../api/types'

/** Every scene in a game, chapters flattened, in document order. */
const scenesOf = (game: Game | null | undefined): Scene[] => {
  if (!game || !Array.isArray(game.chapters)) return []
  return game.chapters.flatMap((chapter) => (Array.isArray(chapter?.scenes) ? chapter.scenes : []))
}

const declared = (scene: Scene | null | undefined): readonly Prop[] | undefined => {
  const props = (scene as { props?: readonly Prop[] } | null | undefined)?.props
  return Array.isArray(props) && props.length > 0 ? props : undefined
}

/** The concept a scene teaches, when it has one. Dialogue scenes do not. */
const conceptOf = (scene: Scene | null | undefined): string | undefined => {
  const id = (scene as { concept_id?: unknown } | null | undefined)?.concept_id
  return typeof id === 'string' && id.length > 0 ? id : undefined
}

/**
 * The props to illustrate `scene` with, or `undefined` for none.
 *
 * Pass `undefined` rather than an empty array to `SceneIllustration`: an empty
 * array still renders a wrapper, and a question with nothing to show should
 * take up no room at all.
 */
export function illustrationProps(
  scene: Scene | null | undefined,
  source: Game | null | undefined,
): readonly Prop[] | undefined {
  const own = declared(scene)
  if (own) return own

  const concept = conceptOf(scene)
  if (!concept) return undefined

  // First in document order, so the same question always draws the same thing.
  for (const candidate of scenesOf(source)) {
    if (conceptOf(candidate) !== concept) continue
    const props = declared(candidate)
    if (props) return props
  }
  return undefined
}
