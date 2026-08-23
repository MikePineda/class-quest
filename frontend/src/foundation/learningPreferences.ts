export type LearningMode = 'solo' | 'async_group' | 'live_group' | 'undecided'
export type LearningGoal = 'understand' | 'assessment' | 'review' | 'confidence'
export type SessionLength = 'quick' | 'focused' | 'ongoing'

export interface LearningPreferences {
  mode: LearningMode
  goal: LearningGoal
  sessionLength: SessionLength
}

export const DEFAULT_LEARNING_PREFERENCES: LearningPreferences = {
  mode: 'solo',
  goal: 'understand',
  sessionLength: 'focused',
}

const keyFor = (userId: string): string => `classquest.learning-preferences.${userId}`

const isMode = (value: unknown): value is LearningMode =>
  value === 'solo' || value === 'async_group' || value === 'live_group' || value === 'undecided'

const isGoal = (value: unknown): value is LearningGoal =>
  value === 'understand' || value === 'assessment' || value === 'review' || value === 'confidence'

const isSessionLength = (value: unknown): value is SessionLength =>
  value === 'quick' || value === 'focused' || value === 'ongoing'

/** Preferences are non-sensitive and local until the profile API grows a preference contract. */
export function loadLearningPreferences(userId: string): LearningPreferences {
  try {
    const raw = window.localStorage.getItem(keyFor(userId))
    if (!raw) return DEFAULT_LEARNING_PREFERENCES
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return DEFAULT_LEARNING_PREFERENCES
    const value = parsed as Record<string, unknown>
    if (!isMode(value.mode) || !isGoal(value.goal) || !isSessionLength(value.sessionLength)) {
      return DEFAULT_LEARNING_PREFERENCES
    }
    return { mode: value.mode, goal: value.goal, sessionLength: value.sessionLength }
  } catch {
    return DEFAULT_LEARNING_PREFERENCES
  }
}

export function saveLearningPreferences(userId: string, preferences: LearningPreferences): void {
  try {
    window.localStorage.setItem(keyFor(userId), JSON.stringify(preferences))
  } catch {
    // Private browsing or a blocked storage policy should never block profile setup.
  }
}
