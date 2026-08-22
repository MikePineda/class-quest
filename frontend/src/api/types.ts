/**
 * Hand-written mirror of the backend contract. Once the API is deployed,
 * `npm run gen:api` writes `types.gen.ts`; migrate imports then. Until then
 * this file is the contract.
 *
 * Source of truth: CONTRACTS.md (repo root), schema/course-graph.schema.json,
 * schema/game.schema.json.
 */

// ---------------------------------------------------------------------------
// Content contract (schema/*.schema.json)
// ---------------------------------------------------------------------------

export type BloomLevel = 'remember' | 'understand' | 'apply' | 'analyse' | 'evaluate' | 'create'
export type Archetype = 'quest' | 'gauntlet'
export type Background = 'cavern' | 'forest_path' | 'ruins' | 'observatory' | 'shore' | 'village'
export type Actor = 'explorer' | 'mentor_owl' | 'rival' | 'villager'
export type Prop = 'doorway_pair' | 'chart_frame' | 'lantern' | 'crystal_cluster' | 'chest' | 'signpost'
export type Widget = 'curve_fit' | 'threshold_slider' | 'sorting_bins' | 'graph_walk'

export interface SourceSpan {
  segment_id: number
  /** Verbatim text from the segment; validated server-side. */
  quote: string
}

export interface Misconception {
  id: string
  /** The wrong belief, in the learner's voice. */
  statement: string
  why_plausible: string
  /** Shown after the learner commits. */
  correction: string
}

export interface Concept {
  id: string
  label: string
  summary: string
  bloom_level: BloomLevel
  /** Concept ids that must be taught first. Acyclic. */
  prerequisites: string[]
  source_spans: SourceSpan[]
  misconceptions: Misconception[]
}

export interface CourseGraph {
  schema_version: '1.0'
  graph_id: string
  source: { title: string; segment_count: number }
  concepts: Concept[]
}

/** Incorrect options always carry `misconception_id`; the correct one never does. */
export type Option =
  | { id: string; text: string; correct: true; misconception_id?: undefined }
  | { id: string; text: string; correct: false; misconception_id: string }

export interface DialogueScene {
  type: 'dialogue'
  id: string
  speaker: Actor
  props?: Prop[]
  lines: string[]
}

export interface PredictionScene {
  type: 'prediction'
  id: string
  concept_id: string
  props?: Prop[]
  prompt: string
  options: Option[]
  /** Shown after the learner commits, whatever they chose. */
  reveal: string
}

export interface SimulationScene {
  type: 'simulation'
  id: string
  concept_id: string
  widget: Widget
  instruction: string
  success_condition?: string
}

export type Scene = DialogueScene | PredictionScene | SimulationScene

export interface Chapter {
  id: string
  title: string
  concept_ids: string[]
  background: Background
  scenes: Scene[]
}

export interface Game {
  schema_version: '1.0'
  game_id: string
  /** Quest and gauntlet built from the same upload share this value. */
  graph_id: string
  archetype: Archetype
  title: string
  chapters: Chapter[]
}

// ---------------------------------------------------------------------------
// API contract (CONTRACTS.md section 3)
// ---------------------------------------------------------------------------

export type Role = 'student' | 'teacher'
export type GenerationStatus = 'pending' | 'processing' | 'ready' | 'failed'
export type MemberRole = 'owner' | 'member'

export interface HealthOut {
  status: 'ok' | 'degraded'
  db: 'ok' | 'error'
  llm: 'live' | 'fixtures'
  version: string
}

export interface User {
  id: string
  email: string
  display_name: string
  role: Role | null
  industry: string | null
  about: string | null
  created_at: string
}

export interface RegisterIn {
  email: string
  /** >= 8 chars. */
  password: string
  display_name: string
}

export interface LoginIn {
  email: string
  password: string
}

export interface TokenOut {
  token: string
  token_type: 'bearer'
  user: User
}

/** All fields optional; only keys present in the body are changed. */
export interface ProfileUpdateIn {
  display_name?: string
  role?: Role
  industry?: string
  about?: string
}

export interface ServerSummary {
  id: string
  name: string
  description: string | null
  /** Omitted (undefined) on `GET /servers/public`. */
  join_code?: string
  is_public: boolean
  /** Free string (<= 32); the mascot rendered when `speaker === 'mentor_owl'`. */
  pet: string
  status: GenerationStatus
  error: string | null
  owner_id: string
  member_count: number
  world_count: number
  my_role: MemberRole | null
  my_xp: number
  created_at: string
}

export interface GenerationEvent {
  ts: string
  stage: string
  message: string
  world_id?: string | null
}

export interface Progress {
  worlds_total: number
  worlds_ready: number
  worlds_failed: number
  stage: string
  /** 0-100 */
  percent: number
  /** Last 20 events. */
  log: GenerationEvent[]
}

export interface WorldSummary {
  id: string
  idx: number
  title: string
  blurb: string | null
  status: GenerationStatus
  stage: string | null
  error: string | null
  graph_id: string | null
  quest_id: string | null
  gauntlet_id: string | null
  concept_count: number
  scene_count: number
  my_xp: number
  /** 0-1 */
  my_completion: number
}

export interface ServerDetail extends ServerSummary {
  progress: Progress
  worlds: WorldSummary[]
}

export interface ServerListOut {
  servers: ServerSummary[]
}

export interface JoinIn {
  join_code: string
}

export interface JoinOut {
  server: ServerSummary
  already_member: boolean
}

export interface LeaderboardEntry {
  rank: number
  user_id: string
  display_name: string
  xp: number
  attempts: number
}

export interface LeaderboardOut {
  server_id: string
  me: LeaderboardEntry | null
  /** Top 50. */
  entries: LeaderboardEntry[]
}

export interface DistributionOption {
  option_id: string
  text: string
  correct: boolean
  misconception_id?: string
  count: number
  /** 0-100 */
  pct: number
}

export interface SceneDistribution {
  world_id: string
  scene_id: string
  concept_id: string
  options: DistributionOption[]
}

export interface CohortOut extends LeaderboardOut {
  members_count: number
  predictions_made: number
  distribution: SceneDistribution[]
  hardest_concept: { concept_id: string; label: string; wrong_pct: number } | null
}

export interface MyProgress {
  xp: number
  scenes_total: number
  scenes_attempted: number
  scenes_correct: number
  explained_concept_ids: string[]
}

export interface WorldDetail extends WorldSummary {
  server_id: string
  segment_start: number
  segment_end: number
  graph: CourseGraph | null
  /** `gauntlet` may be null independently of `quest` (degraded mode). */
  games: { quest: Game | null; gauntlet: Game | null }
  my_progress: MyProgress
}

/** The client never sends `correct`; the server grades from the stored game. */
export interface AttemptIn {
  archetype: Archetype
  scene_id: string
  option_id: string
}

export interface AttemptOut {
  attempt_id: string
  correct: boolean
  /** 0 on repeat attempts. */
  xp_awarded: number
  first_time: boolean
  misconception: { id: string; statement: string; correction: string } | null
  reveal: string
  world_xp: number
  server_xp: number
}

export interface SceneProgress {
  scene_id: string
  archetype: Archetype
  attempts: number
  best_correct: boolean
  chosen_option_id: string | null
}

export interface ExplanationRecord {
  concept_id: string
  score: number
  verdict: ExplainVerdict
  created_at: string
}

export interface ProgressOut {
  world_id: string
  xp: number
  scenes: SceneProgress[]
  explanations: ExplanationRecord[]
}

export type ExplainVerdict = 'pass' | 'partial' | 'fail'

export interface ExplainIn {
  concept_id: string
  /** 20-4000 chars. */
  text: string
}

export interface ExplainOut {
  /** 0-100; >= 70 pass, 40-69 partial. */
  score: number
  verdict: ExplainVerdict
  xp_awarded: number
  feedback: string
  misconception_id: string | null
  concept: { id: string; label: string; summary: string }
  world_xp: number
  server_xp: number
}

/** FastAPI error body. `detail` is a string for app errors, a list for 422 validation errors. */
export interface ApiErrorBody {
  detail: string | Array<{ loc: Array<string | number>; msg: string; type: string }>
}
