import { describe, expect, it } from 'vitest'

import type { Game, Scene } from '../api/types'
import { illustrationProps } from './conceptProps'

const prediction = (id: string, concept: string, props?: string[]): Scene =>
  ({
    type: 'prediction',
    id,
    concept_id: concept,
    prompt: 'p',
    options: [],
    reveal: 'r',
    ...(props ? { props } : {}),
  }) as unknown as Scene

const dialogue = (id: string, props?: string[]): Scene =>
  ({ type: 'dialogue', id, speaker: 'explorer', lines: ['x'], ...(props ? { props } : {}) }) as unknown as Scene

const game = (scenes: Scene[][]): Game =>
  ({
    schema_version: '1.0',
    game_id: 'g1',
    graph_id: 'gr1',
    archetype: 'quest',
    title: 't',
    chapters: scenes.map((list, i) => ({
      id: `c${i}`,
      title: `C${i}`,
      concept_ids: ['a'],
      background: 'cavern',
      scenes: list,
    })),
  }) as unknown as Game

describe('illustrationProps', () => {
  it('keeps a scene that declared its own props', () => {
    const own = prediction('q1', 'supervised', ['chest'])
    const quest = game([[prediction('s1', 'supervised', ['chart_frame'])]])
    // The scene's own choice always wins; nothing is overridden.
    expect(illustrationProps(own, quest)).toEqual(['chest'])
  })

  it('inherits from a quest scene about the same concept', () => {
    const question = prediction('q1', 'supervised')
    const quest = game([[prediction('s1', 'supervised', ['chart_frame'])]])
    expect(illustrationProps(question, quest)).toEqual(['chart_frame'])
  })

  it('never borrows across concepts', () => {
    const question = prediction('q1', 'regression')
    const quest = game([[prediction('s1', 'supervised', ['chart_frame'])]])
    // A picture chosen for one idea says nothing about another.
    expect(illustrationProps(question, quest)).toBeUndefined()
  })

  it('gives nothing rather than a stand-in when the concept was never illustrated', () => {
    const question = prediction('q1', 'supervised')
    const quest = game([[prediction('s1', 'supervised')]])
    expect(illustrationProps(question, quest)).toBeUndefined()
  })

  it('is deterministic: the first illustrated scene in document order wins', () => {
    const question = prediction('q1', 'supervised')
    const quest = game([
      [prediction('s1', 'supervised', ['chart_frame'])],
      [prediction('s2', 'supervised', ['chest'])],
    ])
    expect(illustrationProps(question, quest)).toEqual(['chart_frame'])
    expect(illustrationProps(question, quest)).toEqual(['chart_frame'])
  })

  it('ignores a scene with no concept, like dialogue', () => {
    expect(illustrationProps(dialogue('d1'), game([[prediction('s1', 'a', ['chest'])]]))).toBeUndefined()
  })

  it('treats an empty props array as none, so no empty wrapper is rendered', () => {
    const question = prediction('q1', 'supervised', [])
    const quest = game([[prediction('s1', 'supervised', ['chart_frame'])]])
    expect(illustrationProps(question, quest)).toEqual(['chart_frame'])
  })

  it('never throws on junk, because it runs while the world renders', () => {
    expect(illustrationProps(null, null)).toBeUndefined()
    expect(illustrationProps(undefined, undefined)).toBeUndefined()
    expect(illustrationProps(prediction('q1', 'a'), {} as Game)).toBeUndefined()
    expect(illustrationProps(prediction('q1', 'a'), { chapters: null } as unknown as Game)).toBeUndefined()
    expect(illustrationProps(prediction('q1', 'a'), { chapters: [{}] } as unknown as Game)).toBeUndefined()
  })
})
