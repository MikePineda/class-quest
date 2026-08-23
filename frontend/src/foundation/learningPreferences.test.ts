import { beforeEach, describe, expect, it } from 'vitest'

import { DEFAULT_LEARNING_PREFERENCES, loadLearningPreferences, saveLearningPreferences } from './learningPreferences'

describe('learning preferences', () => {
  const values = new Map<string, string>()
  beforeEach(() => {
    values.clear()
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { localStorage: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), clear: () => values.clear() } },
    })
  })

  it('defaults safely and round-trips non-sensitive preferences', () => {
    expect(loadLearningPreferences('user-1')).toEqual(DEFAULT_LEARNING_PREFERENCES)
    const preferences = { mode: 'async_group' as const, goal: 'review' as const, sessionLength: 'quick' as const }
    saveLearningPreferences('user-1', preferences)
    expect(loadLearningPreferences('user-1')).toEqual(preferences)
  })

  it('rejects malformed stored values', () => {
    window.localStorage.setItem('classquest.learning-preferences.user-1', JSON.stringify({ mode: 'unknown' }))
    expect(loadLearningPreferences('user-1')).toEqual(DEFAULT_LEARNING_PREFERENCES)
  })
})
