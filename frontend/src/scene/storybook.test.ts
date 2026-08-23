import { describe, expect, it } from 'vitest'
import type { Chapter, Concept, CourseGraph, Game } from '../api/types'
import { buildStory, pageRead, storyConceptIds } from './storybook'
import { bundles } from '../fixtures'

const concept = (id: string, label = id): Concept => ({
  id,
  label,
  summary: `About ${label}.`,
  bloom_level: 'understand',
  prerequisites: [],
  source_spans: [],
  misconceptions: [],
})

const graphOf = (...concepts: Concept[]): CourseGraph => ({
  schema_version: '1.0',
  graph_id: 'g1',
  source: { title: 'Notes', segment_count: 1 },
  concepts,
})

const questOf = (...chapters: Chapter[]): Game => ({
  schema_version: '1.0',
  game_id: 'q1',
  graph_id: 'g1',
  archetype: 'quest',
  title: 'A quest',
  chapters,
})

const chapter = (over: Partial<Chapter> = {}): Chapter => ({
  id: 'ch',
  title: 'A chapter',
  concept_ids: [],
  background: 'cavern',
  scenes: [],
  ...over,
})

// ------------------------------------------------------------------- shape

describe('buildStory', () => {
  it('turns each chapter into a page in the order the quest wrote them', () => {
    const graph = graphOf(concept('a'), concept('b'))
    const quest = questOf(
      chapter({ id: 'one', title: 'First', concept_ids: ['a'] }),
      chapter({ id: 'two', title: 'Second', concept_ids: ['b'] }),
    )
    expect(buildStory(graph, quest).map((page) => page.title)).toEqual(['First', 'Second'])
  })

  it('reads the chapter dialogue as the beats of the page', () => {
    const quest = questOf(
      chapter({
        concept_ids: ['a'],
        scenes: [
          { type: 'dialogue', id: 'd', speaker: 'villager', lines: ['One.', 'Two.'] },
        ],
      }),
    )
    const [page] = buildStory(graphOf(concept('a')), quest)
    expect(page.beats).toEqual(['One.', 'Two.'])
    expect(page.narrator).toBe('villager')
  })

  it('keeps dialogue that comes after a question, not just the opening scene', () => {
    const quest = questOf(
      chapter({
        concept_ids: ['a'],
        scenes: [
          { type: 'dialogue', id: 'd1', speaker: 'mentor_owl', lines: ['Before.'] },
          {
            type: 'prediction', id: 'p', concept_id: 'a', prompt: 'p?',
            options: [{ id: 'o', text: 'o', correct: true }], reveal: 'r',
          },
          { type: 'dialogue', id: 'd2', speaker: 'mentor_owl', lines: ['After.'] },
        ],
      }),
    )
    expect(buildStory(graphOf(concept('a')), quest)[0].beats).toEqual(['Before.', 'After.'])
  })

  it('drops blank lines rather than printing an empty speech bubble', () => {
    const quest = questOf(
      chapter({
        concept_ids: ['a'],
        scenes: [{ type: 'dialogue', id: 'd', speaker: 'mentor_owl', lines: ['  ', 'Real.', ''] }],
      }),
    )
    expect(buildStory(graphOf(concept('a')), quest)[0].beats).toEqual(['Real.'])
  })

  it('falls back to the mascot when a chapter narrates without a speaker', () => {
    const quest = questOf(chapter({ concept_ids: ['a'] }))
    expect(buildStory(graphOf(concept('a')), quest)[0].narrator).toBe('mentor_owl')
  })
})

// ----------------------------------------------------------------- concepts

describe('the concepts a page teaches', () => {
  it('resolves them against the graph so the page carries real content', () => {
    const graph = graphOf(concept('a', 'Alpha'))
    const quest = questOf(chapter({ concept_ids: ['a'] }))
    expect(buildStory(graph, quest)[0].concepts.map((c) => c.label)).toEqual(['Alpha'])
  })

  it('ignores a concept id the graph does not have', () => {
    const quest = questOf(chapter({ concept_ids: ['a', 'ghost'] }))
    expect(buildStory(graphOf(concept('a')), quest)[0].concepts.map((c) => c.id)).toEqual(['a'])
  })

  it('picks up concepts its scenes name when the chapter header did not', () => {
    const quest = questOf(
      chapter({
        concept_ids: [],
        scenes: [
          {
            type: 'prediction', id: 'p', concept_id: 'a', prompt: 'p?',
            options: [{ id: 'o', text: 'o', correct: true }], reveal: 'r',
          },
        ],
      }),
    )
    expect(buildStory(graphOf(concept('a')), quest)[0].concepts.map((c) => c.id)).toEqual(['a'])
  })

  it('never teaches the same concept twice on one page', () => {
    const quest = questOf(
      chapter({
        concept_ids: ['a'],
        scenes: [
          {
            type: 'prediction', id: 'p', concept_id: 'a', prompt: 'p?',
            options: [{ id: 'o', text: 'o', correct: true }], reveal: 'r',
          },
        ],
      }),
    )
    expect(buildStory(graphOf(concept('a')), quest)[0].concepts).toHaveLength(1)
  })

  it('gives a concept no chapter claimed its own page, after the chapters', () => {
    const graph = graphOf(concept('a'), concept('lonely', 'Lonely'))
    const quest = questOf(chapter({ title: 'First', concept_ids: ['a'] }))
    expect(buildStory(graph, quest).map((page) => page.title)).toEqual(['First', 'Lonely'])
  })

  it('covers the whole graph however thin the quest is', () => {
    const graph = graphOf(concept('a'), concept('b'), concept('c'))
    const quest = questOf(chapter({ concept_ids: ['b'] }))
    expect(storyConceptIds(buildStory(graph, quest)).sort()).toEqual(['a', 'b', 'c'])
  })
})

// ------------------------------------------------------------------- props

describe('what stands on the page', () => {
  it('takes the props the narrated scene declared', () => {
    const quest = questOf(
      chapter({
        concept_ids: ['a'],
        scenes: [{ type: 'dialogue', id: 'd', speaker: 'mentor_owl', lines: ['Hi.'], props: ['lantern'] }],
      }),
    )
    expect(buildStory(graphOf(concept('a')), quest)[0].props).toEqual(['lantern'])
  })

  it('borrows from the chapter\'s questions when the story scene declared none', () => {
    const quest = questOf(
      chapter({
        concept_ids: ['a'],
        scenes: [
          { type: 'dialogue', id: 'd', speaker: 'mentor_owl', lines: ['Hi.'] },
          {
            type: 'prediction', id: 'p', concept_id: 'a', props: ['chest'], prompt: 'p?',
            options: [{ id: 'o', text: 'o', correct: true }], reveal: 'r',
          },
        ],
      }),
    )
    expect(buildStory(graphOf(concept('a')), quest)[0].props).toEqual(['chest'])
  })

  it('caps the row so a long chapter does not line up eight sprites', () => {
    const quest = questOf(
      chapter({
        concept_ids: ['a'],
        scenes: [
          { type: 'dialogue', id: 'd', speaker: 'mentor_owl', lines: ['Hi.'], props: ['lantern', 'chest'] },
          {
            type: 'prediction', id: 'p', concept_id: 'a', prompt: 'p?',
            props: ['signpost', 'crystal_cluster', 'doorway_pair'],
            options: [{ id: 'o', text: 'o', correct: true }], reveal: 'r',
          },
        ],
      }),
    )
    expect(buildStory(graphOf(concept('a')), quest)[0].props).toEqual(['lantern', 'chest', 'signpost'])
  })

  it('never repeats a prop that two scenes both declared', () => {
    const quest = questOf(
      chapter({
        concept_ids: ['a'],
        scenes: [
          { type: 'dialogue', id: 'd', speaker: 'mentor_owl', lines: ['Hi.'], props: ['lantern'] },
          {
            type: 'prediction', id: 'p', concept_id: 'a', props: ['lantern'], prompt: 'p?',
            options: [{ id: 'o', text: 'o', correct: true }], reveal: 'r',
          },
        ],
      }),
    )
    expect(buildStory(graphOf(concept('a')), quest)[0].props).toEqual(['lantern'])
  })
})

// ------------------------------------------------------------- degrading

describe('a world the generator was unkind to', () => {
  it('falls back to one page per concept with no quest at all', () => {
    const pages = buildStory(graphOf(concept('a', 'Alpha'), concept('b', 'Beta')), null)
    expect(pages.map((page) => page.title)).toEqual(['Alpha', 'Beta'])
    expect(pages.every((page) => page.beats.length === 0)).toBe(true)
  })

  it('is empty for an empty graph rather than throwing', () => {
    expect(buildStory(graphOf(), questOf(chapter()))).toEqual([])
    expect(buildStory(null, null)).toEqual([])
  })

  it('skips a chapter that neither says nor teaches anything', () => {
    const quest = questOf(chapter({ title: 'Hollow' }), chapter({ title: 'Real', concept_ids: ['a'] }))
    expect(buildStory(graphOf(concept('a')), quest).map((p) => p.title)).toEqual(['Real'])
  })

  it('keeps a chapter that only narrates, because that is still the story', () => {
    const quest = questOf(
      chapter({
        title: 'Prologue',
        scenes: [{ type: 'dialogue', id: 'd', speaker: 'mentor_owl', lines: ['Once.'] }],
      }),
      chapter({ title: 'One', concept_ids: ['a'] }),
    )
    expect(buildStory(graphOf(concept('a')), quest).map((p) => p.title)).toEqual(['Prologue', 'One'])
  })

  it('names an untitled chapter after what it teaches', () => {
    const quest = questOf(chapter({ title: '   ', concept_ids: ['a'] }))
    expect(buildStory(graphOf(concept('a', 'Alpha')), quest)[0].title).toBe('Alpha')
  })

  it('survives chapters and scenes that are not objects at all', () => {
    const quest = { ...questOf(), chapters: [null, 'nope', { id: 'x', scenes: 'no' }] } as unknown as Game
    expect(() => buildStory(graphOf(concept('a')), quest)).not.toThrow()
    expect(buildStory(graphOf(concept('a')), quest).map((p) => p.title)).toEqual(['a'])
  })
})

// -------------------------------------------------------------- read state

describe('pageRead', () => {
  const page = (ids: string[]) => ({
    id: 'p', title: 'p', background: null, props: [], narrator: 'mentor_owl' as const,
    beats: [], concepts: ids.map((id) => concept(id)),
  })

  it('is true only once every concept on it has been opened', () => {
    expect(pageRead(page(['a', 'b']), new Set(['a']))).toBe(false)
    expect(pageRead(page(['a', 'b']), new Set(['a', 'b']))).toBe(true)
  })

  it('is false for a page that teaches nothing, so narration is not progress', () => {
    expect(pageRead(page([]), new Set(['a']))).toBe(false)
  })
})

// --------------------------------------------------------- the real content

describe('the shipped fixtures', () => {
  it.each(['pybasics', 'overfitting'] as const)('%s reads as a story with pictures', (name) => {
    const bundle = bundles[name]
    const pages = buildStory(bundle.graph, bundle.quest)

    expect(pages.length).toBeGreaterThan(0)
    // The whole reason for the redesign: there is narration to show...
    expect(pages.some((page) => page.beats.length > 0)).toBe(true)
    // ...and something to draw beside it.
    expect(pages.some((page) => page.props.length > 0)).toBe(true)
    // ...and no concept is lost on the way.
    expect(storyConceptIds(pages).sort()).toEqual(bundle.graph.concepts.map((c) => c.id).sort())
  })
})
