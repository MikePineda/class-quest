/**
 * The reading portal's story model: the quest, re-read as a storybook.
 *
 * ## Why this exists
 *
 * The generator has been writing narrative all along and nobody has been able
 * to read it. Every quest carries chapters with their own titles, a biome, a
 * narrator, and dialogue scenes whose `lines` are prose written *from the
 * learner's own material* — "Every crate in this village wears a label, and
 * every label can be peeled off and stuck on another crate." Since the hub
 * redesign the quest is not walkable, so all of it has been dead weight in the
 * payload while the reading gate showed a definition list.
 *
 * This module is the join: chapters become pages, their dialogue becomes the
 * beats of the page, and the graph concepts the chapter teaches become the
 * study material underneath. Nothing here writes a word. Every title, every
 * beat and every summary is content that was already in the world.
 *
 * ## The rules it keeps
 *
 * - **Chapter order is teaching order**, exactly as concept order was: the
 *   quest is built from the graph, which is already sorted so nothing depends
 *   on something further down. No sorting happens here.
 * - **Nothing is invented, including structure.** A chapter with no dialogue
 *   has no beats and renders as a page that goes straight to the material. A
 *   concept no chapter claims still gets a page, because losing it would hide
 *   part of the course.
 * - **Total and pure.** A missing quest, a chapter naming a concept that is not
 *   in the graph, a dialogue scene with no lines: every one of those is a
 *   thinner page, never a throw. It runs while the portal opens.
 */

import type { Actor, Background, Chapter, Concept, CourseGraph, Game, Prop, Scene } from '../api/types'

/** Who narrates when a chapter's dialogue does not say. The mascot is the
 *  storyteller on the map, so it is the storyteller here too. */
const DEFAULT_NARRATOR: Actor = 'mentor_owl'

export interface StoryPage {
  /** Stable across renders: the chapter's own id, or `concept:<id>`. */
  id: string
  /** The chapter's title, or the concept's label when there is no chapter. */
  title: string
  /** Where this happens. Null when no chapter declared it. */
  background: Background | null
  /** What stands in the scene. Empty renders no illustration at all. */
  props: readonly Prop[]
  /** Who is talking. */
  narrator: Actor
  /** The narration, one line at a time, in the order it was written. */
  beats: string[]
  /** What this page teaches, resolved against the graph. May be empty. */
  concepts: Concept[]
}

const isDialogue = (scene: Scene | null | undefined): scene is Extract<Scene, { type: 'dialogue' }> =>
  !!scene && scene.type === 'dialogue'

const scenesOf = (chapter: Chapter | null | undefined): Scene[] =>
  Array.isArray(chapter?.scenes) ? chapter.scenes : []

/** Text that survives being printed. Whitespace is a generator artefact. */
const speakable = (line: unknown): line is string => typeof line === 'string' && line.trim().length > 0

/**
 * Every narrated line in the chapter, in document order.
 *
 * All the dialogue scenes, not just the first: a chapter is free to break its
 * narration around the questions, and dropping the later halves would end
 * stories mid-sentence.
 */
function beatsOf(chapter: Chapter): string[] {
  return scenesOf(chapter)
    .filter(isDialogue)
    .flatMap((scene) => (Array.isArray(scene.lines) ? scene.lines : []))
    .filter(speakable)
    .map((line) => line.trim())
}

/**
 * What the chapter puts on stage.
 *
 * The dialogue scene's props first — that is the scene the narration belongs
 * to — then anything a question in the same chapter declared, so a chapter
 * whose story scene declared nothing still gets the picture its questions had.
 * De-duplicated, order preserved, and capped: the schema allows three per
 * scene and a chapter has several scenes, so an uncapped merge would line up
 * eight sprites in a band sized for two.
 */
const MAX_PROPS = 3

function propsOf(chapter: Chapter): readonly Prop[] {
  const scenes = scenesOf(chapter)
  const ordered = [...scenes.filter(isDialogue), ...scenes.filter((scene) => !isDialogue(scene))]
  const seen = new Set<Prop>()
  for (const scene of ordered) {
    const declared = (scene as { props?: readonly Prop[] }).props
    if (!Array.isArray(declared)) continue
    for (const prop of declared) {
      if (seen.size >= MAX_PROPS) break
      seen.add(prop)
    }
  }
  return [...seen]
}

/**
 * The concepts a chapter teaches.
 *
 * `concept_ids` is the chapter's own claim and comes first; its scenes are the
 * fallback, because a chapter whose header is thin can still be full of
 * questions that name what they are about. Ids with nothing behind them in the
 * graph are dropped — a dangling reference is not a lesson.
 */
function conceptsOf(chapter: Chapter, byId: Map<string, Concept>): Concept[] {
  const ids: string[] = []
  const push = (id: unknown) => {
    if (typeof id === 'string' && id && !ids.includes(id)) ids.push(id)
  }
  if (Array.isArray(chapter.concept_ids)) chapter.concept_ids.forEach(push)
  for (const scene of scenesOf(chapter)) push((scene as { concept_id?: unknown }).concept_id)
  return ids.map((id) => byId.get(id)).filter((concept): concept is Concept => concept !== undefined)
}

/** The narrator of the chapter's first dialogue scene, or the mascot. */
function narratorOf(chapter: Chapter): Actor {
  const spoken = scenesOf(chapter).find(isDialogue)
  return spoken && typeof spoken.speaker === 'string' ? spoken.speaker : DEFAULT_NARRATOR
}

/** One page per concept: what a world with no quest, or no chapters, falls back to. */
function pagesFromConcepts(concepts: readonly Concept[]): StoryPage[] {
  return concepts.map((concept) => ({
    id: `concept:${concept.id}`,
    title: concept.label,
    background: null,
    props: [],
    narrator: DEFAULT_NARRATOR,
    beats: [],
    concepts: [concept],
  }))
}

/**
 * The pages of the storybook, in the order the course builds.
 *
 * Chapters first, then any concept no chapter claimed, so the reading gate
 * still covers the whole graph however the quest came out. A world with no
 * usable quest degrades to exactly what this panel showed before it learned
 * about chapters: one page per concept.
 */
export function buildStory(graph: CourseGraph | null, quest: Game | null | undefined): StoryPage[] {
  const concepts = Array.isArray(graph?.concepts) ? graph.concepts : []
  if (concepts.length === 0) return []

  const byId = new Map(concepts.map((concept) => [concept.id, concept]))
  const chapters = Array.isArray(quest?.chapters) ? quest.chapters : []

  const claimed = new Set<string>()
  const pages: StoryPage[] = []

  for (const chapter of chapters) {
    if (!chapter || typeof chapter !== 'object') continue
    const taught = conceptsOf(chapter, byId)
    const beats = beatsOf(chapter)
    // A chapter that neither says anything nor teaches anything is an empty
    // page. Printing it would be printing the payload's shape at the learner.
    if (taught.length === 0 && beats.length === 0) continue
    taught.forEach((concept) => claimed.add(concept.id))
    pages.push({
      id: typeof chapter.id === 'string' && chapter.id ? chapter.id : `chapter:${pages.length}`,
      title: typeof chapter.title === 'string' && chapter.title.trim() ? chapter.title.trim() : taught[0]?.label ?? 'This chapter',
      background: chapter.background ?? null,
      props: propsOf(chapter),
      narrator: narratorOf(chapter),
      beats,
      concepts: taught,
    })
  }

  const orphans = concepts.filter((concept) => !claimed.has(concept.id))
  return [...pages, ...pagesFromConcepts(orphans)]
}

/** Every concept the story covers, in page order. Drives the read count. */
export function storyConceptIds(pages: readonly StoryPage[]): string[] {
  const ids: string[] = []
  for (const page of pages) {
    for (const concept of page.concepts) {
      if (!ids.includes(concept.id)) ids.push(concept.id)
    }
  }
  return ids
}

/** A page counts as read once every concept on it has been opened. */
export function pageRead(page: StoryPage, readIds: ReadonlySet<string>): boolean {
  return page.concepts.length > 0 && page.concepts.every((concept) => readIds.has(concept.id))
}
