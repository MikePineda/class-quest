# ClassQuest API contract (for the frontend)

Everything the FE needs to talk to the backend. TypeScript mirror: `frontend/src/api/types.ts`; typed client: `frontend/src/api/client.ts` (`api.*`); polling helper: `frontend/src/api/poll.ts`. Offline fixtures: `frontend/src/fixtures/`.

## Basics

| Thing | Value |
|---|---|
| Base URL (prod) | `https://api.classquest.net` — set as `VITE_API_URL` |
| Base URL (dev) | leave `VITE_API_URL` unset; the client calls `/api/*` and Vite proxies to `VITE_API_PROXY` or `http://localhost:8000` |
| Auth | `Authorization: Bearer <token>` on every endpoint except `/health`, `/auth/register`, `/auth/login`, `/servers/public` |
| Token | JWT, 7 days, no refresh. Client stores it in `localStorage["cq_token"]`. A 401 means: drop the token, show login. |
| Content type | JSON everywhere except `POST /servers` (multipart) |
| Errors | `{"detail": string \| list}` — see Gotchas |
| Interactive docs | `GET /docs` (Swagger), `GET /openapi.json` (feeds `npm run gen:api`) |
| CORS | `http://localhost:5173` and the prod web origin are allowed |
| Demo account | `demo@classquest.app` / `demo1234`. Two public servers, one `ready` world each, both built from the fixtures: "Demo: Programming Fundamentals — Week 1" (`PY101A`) and "Demo: Intro to ML — Week 3" (`DEMO01`) |

Naming (Minecraft analogy): a **Server** is a class/course (name, join code, public/private, pet mascot). A **World** is one generated unit inside a server: a `CourseGraph` + a `quest` game + a `gauntlet` game. A user belongs to N servers.

## Flows

### Onboarding
1. `POST /auth/register` (or `POST /auth/login`) → store `token`.
2. `PATCH /auth/me` with `role`, `industry`, `about` from the personalised questions.
3. `GET /servers` → my servers. Empty? Offer create or join.

### Create a server (teacher / uploader)
1. `POST /servers` multipart (`name`, `pet`, `is_public`, `text` and/or `files[]`) → `201` with `status: "processing"`. Ingestion runs before the response (a few seconds for PDFs); generation runs in the background.
2. Poll `GET /servers/{id}` every 2 s (`pollServer` does this) and render `progress.percent`, `progress.stage`, `progress.log`, and the per-world `worlds[].status`.
3. Stop when `status` is `ready` or `failed`. On `failed`, show `error`. Individual worlds can be `ready` while others are still `processing`; you can let the user enter a ready world early.

### Join a server (student)
1. `POST /servers/join {join_code}` → `{server, already_member}`. Or pick from `GET /servers/public` and join with its code (public listings omit `join_code`; the join button uses the server `id` flow your UI chooses — the API itself joins by code only).
2. `GET /servers/{id}` → worlds list.

### Play a world
1. `GET /worlds/{id}` → `graph`, `games.quest`, `games.gauntlet`, `my_progress`.
2. Render `games.quest.chapters[].scenes[]` in order. `dialogue` → show lines (mascot = server `pet` when `speaker === "mentor_owl"`). `prediction` → prompt + options; on pick, `POST /worlds/{id}/attempts {archetype:"quest", scene_id, option_id}` and show `reveal` + `misconception.correction` if wrong. `simulation` → the hand-built widget named in `widget`.
3. Gauntlet = same loop over `games.gauntlet` with `archetype: "gauntlet"`. Lives and the timer are frontend-only; the server just records attempts.
4. Explain to Win: one-shot with `POST /worlds/{id}/explain {concept_id, text}`, or as a Socratic chat with `POST /worlds/{id}/explain/turn {concept_id, turns}` (both graded synchronously, up to 60 s — show a spinner).
5. `GET /worlds/{id}/progress` to restore state on reload; `GET /servers/{id}/leaderboard` and `/cohort` for the social screens.

## Endpoints

| Method | Path | Auth | Body | Response |
|---|---|---|---|---|
| GET | `/health` | no | — | `HealthOut` |
| POST | `/auth/register` | no | `RegisterIn` | `201 TokenOut` · `409` email taken |
| POST | `/auth/login` | no | `LoginIn` | `TokenOut` · `401` |
| GET | `/auth/me` | yes | — | `User` |
| PATCH | `/auth/me` | yes | `ProfileUpdateIn` (all optional) | `User` |
| POST | `/servers` | yes | multipart (below) | `201 ServerSummary` (`status: "processing"`) |
| GET | `/servers` | yes | — | `{servers: ServerSummary[]}` (mine) |
| GET | `/servers/public` | no | — | `{servers: ServerSummary[]}` (ready + public, no `join_code`) |
| GET | `/servers/{id}` | yes (member or public) | — | `ServerDetail` — **poll this** |
| POST | `/servers/join` | yes | `{join_code}` (case-insensitive) | `JoinOut` · `404` |
| GET | `/servers/{id}/leaderboard` | yes | — | `LeaderboardOut` |
| GET | `/servers/{id}/cohort` | yes | — | `CohortOut` (cut-line) |
| DELETE | `/servers/{id}` | yes (owner) | — | `204` (cut-line) |
| GET | `/worlds/{id}` | yes | — | `WorldDetail` |
| POST | `/worlds/{id}/attempts` | yes | `AttemptIn` | `AttemptOut` |
| GET | `/worlds/{id}/progress` | yes | — | `ProgressOut` |
| POST | `/worlds/{id}/explain` | yes | `ExplainIn` | `ExplainOut` · `503` grader down |
| POST | `/worlds/{id}/explain/turn` | yes | `ExplainChatIn` | `ExplainChatOut` · `503` grader down |

### `GET /health`
```json
{ "status": "ok", "db": "ok", "llm": "live", "version": "0.1.0" }
```
`llm: "fixtures"` means the backend has no LLM key and every generated server gets the fixture content (CI and local dev without a key).

### `POST /auth/register` → 201
```json
// request
{ "email": "ada@example.com", "password": "correct-horse-battery", "display_name": "Ada Lovelace" }
// response (same shape for /auth/login)
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIzZjJhIn0.sig",
  "token_type": "bearer",
  "user": {
    "id": "3f2a9c1e8b7d4e6f9a0b1c2d3e4f5a6b",
    "email": "ada@example.com",
    "display_name": "Ada Lovelace",
    "role": null, "industry": null, "about": null,
    "created_at": "2026-08-22T09:15:00Z"
  }
}
```
Password must be ≥ 8 chars. `POST /auth/login` takes `{email, password}` and returns the same `TokenOut`.

### `PATCH /auth/me`
```json
// request: only keys present are changed
{ "display_name": "Ada L.", "role": "student", "industry": "Software", "about": "Second-year CS student." }
// response: User
{ "id": "3f2a9c1e8b7d4e6f9a0b1c2d3e4f5a6b", "email": "ada@example.com", "display_name": "Ada L.",
  "role": "student", "industry": "Software", "about": "Second-year CS student.",
  "created_at": "2026-08-22T09:15:00Z" }
```
`role` is `"student" | "teacher"`. Users have no pet: the pet belongs to the server (see below).

### `POST /servers` (multipart) → 201
| Field | Type | Notes |
|---|---|---|
| `name` | string | required |
| `description` | string | optional |
| `is_public` | `"true"` / `"false"` | string, as multipart has no booleans |
| `pet` | string | required, ≤ 32 chars; mascot shown for `mentor_owl` |
| `text` | string | optional pasted content |
| `files` | file, repeatable | `.txt .md .pdf .docx .pptx`; max 10 files, 10 MB each |

At least one of `text` / `files`. Total content 400 chars – 400k chars.

```ts
const fd = new FormData()
fd.append('name', 'Intro to ML — Week 3')
fd.append('is_public', 'true')
fd.append('pet', 'owl')
fd.append('text', pastedLectureNotes)
for (const f of fileInput.files) fd.append('files', f)
const server = await api.createServer(fd)
```
```json
{
  "id": "9c1e8b7d4e6f9a0b1c2d3e4f5a6b3f2a",
  "name": "Intro to ML — Week 3",
  "description": null,
  "join_code": "K7Q2MX",
  "is_public": true,
  "pet": "owl",
  "status": "processing",
  "error": null,
  "owner_id": "3f2a9c1e8b7d4e6f9a0b1c2d3e4f5a6b",
  "member_count": 1,
  "world_count": 0,
  "my_role": "owner",
  "my_xp": 0,
  "created_at": "2026-08-22T09:20:00Z"
}
```
`status` moves `pending → processing → ready | failed`. `world_count` becomes known once the planner has split the content (a few seconds in).

### `GET /servers` · `GET /servers/public`
```json
{ "servers": [ { "...": "ServerSummary, see above" } ] }
```
Public listing: only `ready` public servers, and `join_code` is **absent** from each object.

### `GET /servers/{id}` → ServerDetail (polling endpoint)
```json
{
  "id": "9c1e8b7d4e6f9a0b1c2d3e4f5a6b3f2a",
  "name": "Intro to ML — Week 3",
  "description": null,
  "join_code": "K7Q2MX",
  "is_public": true,
  "pet": "owl",
  "status": "processing",
  "error": null,
  "owner_id": "3f2a9c1e8b7d4e6f9a0b1c2d3e4f5a6b",
  "member_count": 1,
  "world_count": 2,
  "my_role": "owner",
  "my_xp": 0,
  "created_at": "2026-08-22T09:20:00Z",
  "progress": {
    "worlds_total": 2,
    "worlds_ready": 1,
    "worlds_failed": 0,
    "stage": "quest",
    "percent": 62,
    "log": [
      { "ts": "2026-08-22T09:20:04Z", "stage": "plan", "message": "Split 14 segments into 2 worlds", "world_id": null },
      { "ts": "2026-08-22T09:20:41Z", "stage": "graph", "message": "Extracted 5 concepts", "world_id": "5b3f2a9c1e8b7d4e6f9a0b1c2d3e4f6a" },
      { "ts": "2026-08-22T09:21:30Z", "stage": "quest", "message": "Quest validated (3 chapters)", "world_id": "5b3f2a9c1e8b7d4e6f9a0b1c2d3e4f6a" }
    ]
  },
  "worlds": [
    {
      "id": "5b3f2a9c1e8b7d4e6f9a0b1c2d3e4f6a",
      "idx": 0,
      "title": "The Archivist's Cavern",
      "blurb": "Training data, generalisation and overfitting.",
      "status": "ready",
      "stage": "done",
      "error": null,
      "graph_id": "wk3ml0a1",
      "quest_id": "q7kp2wm4",
      "gauntlet_id": "g3xn8vr1",
      "concept_count": 5,
      "scene_count": 8,
      "my_xp": 0,
      "my_completion": 0
    },
    {
      "id": "6a5b3f2a9c1e8b7d4e6f9a0b1c2d3e4f",
      "idx": 1,
      "title": "World 2",
      "blurb": null,
      "status": "processing",
      "stage": "graph",
      "error": null,
      "graph_id": null,
      "quest_id": null,
      "gauntlet_id": null,
      "concept_count": 0,
      "scene_count": 0,
      "my_xp": 0,
      "my_completion": 0
    }
  ]
}
```
`progress.log` holds the last 20 events. `my_completion` is 0–1. World `stage` is one of `plan | graph | quest | gauntlet | done` (free string, display as-is).

### `POST /servers/join`
```json
// request
{ "join_code": "demo01" }
// response
{ "server": { "...": "ServerSummary" }, "already_member": false }
```

### `GET /servers/{id}/leaderboard`
```json
{
  "server_id": "9c1e8b7d4e6f9a0b1c2d3e4f5a6b3f2a",
  "me": { "rank": 3, "user_id": "3f2a9c1e8b7d4e6f9a0b1c2d3e4f5a6b", "display_name": "Ada L.", "xp": 42, "attempts": 6 },
  "entries": [
    { "rank": 1, "user_id": "0b1c2d3e4f5a6b3f2a9c1e8b7d4e6f9a", "display_name": "Grace", "xp": 95, "attempts": 11 },
    { "rank": 2, "user_id": "1c2d3e4f5a6b3f2a9c1e8b7d4e6f9a0b", "display_name": "Linus", "xp": 60, "attempts": 8 },
    { "rank": 3, "user_id": "3f2a9c1e8b7d4e6f9a0b1c2d3e4f5a6b", "display_name": "Ada L.", "xp": 42, "attempts": 6 }
  ]
}
```
`entries` is the top 50. `me` is `null` if I have no attempts yet.

### `GET /servers/{id}/cohort`
Leaderboard fields plus:
```json
{
  "server_id": "9c1e8b7d4e6f9a0b1c2d3e4f5a6b3f2a",
  "me": { "...": "LeaderboardEntry" },
  "entries": [],
  "members_count": 27,
  "predictions_made": 143,
  "distribution": [
    {
      "world_id": "5b3f2a9c1e8b7d4e6f9a0b1c2d3e4f6a",
      "scene_id": "sc_pred_overfit",
      "concept_id": "overfitting",
      "options": [
        { "option_id": "op_same",   "text": "It scores about 99 percent again", "correct": false, "misconception_id": "high_train_high_test", "count": 14, "pct": 52 },
        { "option_id": "op_worse",  "text": "It scores far worse",              "correct": true,  "count": 11, "pct": 41 },
        { "option_id": "op_refuse", "text": "It refuses to answer",             "correct": false, "misconception_id": "overfitting_is_bad_data", "count": 2, "pct": 7 }
      ]
    }
  ],
  "hardest_concept": { "concept_id": "overfitting", "label": "Overfitting", "wrong_pct": 59 }
}
```
Counts are first attempts only (one per user per scene), so `pct` is a share of learners, not of clicks.

### `GET /worlds/{id}` → WorldDetail
```json
{
  "id": "5b3f2a9c1e8b7d4e6f9a0b1c2d3e4f6a",
  "idx": 0,
  "title": "The Archivist's Cavern",
  "blurb": "Training data, generalisation and overfitting.",
  "status": "ready",
  "stage": "done",
  "error": null,
  "graph_id": "wk3ml0a1",
  "quest_id": "q7kp2wm4",
  "gauntlet_id": "g3xn8vr1",
  "concept_count": 5,
  "scene_count": 8,
  "my_xp": 12,
  "my_completion": 0.25,
  "server_id": "9c1e8b7d4e6f9a0b1c2d3e4f5a6b3f2a",
  "segment_start": 0,
  "segment_end": 14,
  "graph": { "schema_version": "1.0", "graph_id": "wk3ml0a1", "source": { "title": "Intro to Machine Learning, Week 3", "segment_count": 14 }, "concepts": [ "..." ] },
  "games": {
    "quest":    { "schema_version": "1.0", "game_id": "q7kp2wm4", "graph_id": "wk3ml0a1", "archetype": "quest",    "title": "The Archivist's Cavern", "chapters": [ "..." ] },
    "gauntlet": { "schema_version": "1.0", "game_id": "g3xn8vr1", "graph_id": "wk3ml0a1", "archetype": "gauntlet", "title": "Week 3 Gauntlet",         "chapters": [ "..." ] }
  },
  "my_progress": { "xp": 12, "scenes_total": 8, "scenes_attempted": 2, "scenes_correct": 1, "explained_concept_ids": ["training_data"] }
}
```
`graph`, `games.quest`, `games.gauntlet` are exactly the fixture shapes (`frontend/src/fixtures/*.json`). Any of the three can be `null` while the world is not `ready`; `games.gauntlet` can be `null` even on a `ready` world.

### `POST /worlds/{id}/attempts`
```json
// request — never send `correct`; the server grades against the stored game
{ "archetype": "quest", "scene_id": "sc_pred_overfit", "option_id": "op_same" }
// response (wrong answer, first attempt)
{
  "attempt_id": "7d4e6f9a0b1c2d3e4f5a6b3f2a9c1e8b",
  "correct": false,
  "xp_awarded": 2,
  "first_time": true,
  "misconception": {
    "id": "high_train_high_test",
    "statement": "99 percent on training means roughly 99 percent on new data.",
    "correction": "The two scores decouple once the model starts fitting noise. A near-perfect training score with no validation check is the classic warning sign, not a result."
  },
  "reveal": "Far worse, and the training score gave no warning. It kept climbing while performance on unseen data fell, because the model was fitting the noise in its own study book. That widening gap is the signature of overfitting.",
  "world_xp": 14,
  "server_xp": 14
}
```
Correct answer → `"correct": true, "xp_awarded": 10, "misconception": null`. Repeat attempts on the same scene are recorded but return `xp_awarded: 0, first_time: false`. Unknown `scene_id`/`option_id` → `404`/`422`.

### `GET /worlds/{id}/progress`
```json
{
  "world_id": "5b3f2a9c1e8b7d4e6f9a0b1c2d3e4f6a",
  "xp": 37,
  "scenes": [
    { "scene_id": "sc_pred_training", "archetype": "quest", "attempts": 1, "best_correct": true,  "chosen_option_id": "op_memorised" },
    { "scene_id": "sc_pred_overfit",  "archetype": "quest", "attempts": 2, "best_correct": true,  "chosen_option_id": "op_same" },
    { "scene_id": "g_overfit",        "archetype": "gauntlet", "attempts": 1, "best_correct": false, "chosen_option_id": "op_same" }
  ],
  "explanations": [
    { "concept_id": "training_data", "score": 78, "verdict": "pass", "created_at": "2026-08-22T10:02:11Z" }
  ]
}
```
`chosen_option_id` is the first attempt's choice (what the cohort distribution counts).

### `POST /worlds/{id}/explain` (sync, up to 60 s)
```json
// request
{ "concept_id": "overfitting", "text": "Overfitting is when the model learns the noise in the training set, so training error keeps dropping but error on new data goes up." }
// response
{
  "score": 82,
  "verdict": "pass",
  "xp_awarded": 25,
  "feedback": "You named the mechanism (fitting noise) and the signature (train/validation gap). Mention that capacity, not data quality, is the cause.",
  "misconception_id": null,
  "concept": { "id": "overfitting", "label": "Overfitting", "summary": "A model overfits when it captures noise specific to the training set. Training error keeps falling while error on new data rises." },
  "world_xp": 62,
  "server_xp": 62
}
```
`text` must be 20–4000 chars. Verdict thresholds: `score ≥ 70` pass (25 XP), `40–69` partial (10 XP), else fail (0). XP only on the first pass/partial per concept per world; later tries return `xp_awarded: 0`. `misconception_id` is set when the grader recognises a known wrong belief in the text. `503` if the grader fails — offer retry.

### `POST /worlds/{id}/explain/turn` (sync, the Socratic sibling)

The learner explains, an AI *student* asks follow-ups until it understands, and a comprehension meter fills. **The server keeps no chat state:** post the whole transcript every time — the reply is a pure function of `(concept_id, turns)`. Retrying a failed request means re-posting the identical body.

```json
// request
{
  "concept_id": "overfitting",
  "turns": [
    { "role": "learner", "text": "Overfitting is when a model learns the training data too well." },
    { "role": "student", "text": "Wait — I thought 99 percent on training means roughly 99 percent on new data. Why is that not right?" },
    { "role": "learner", "text": "The two scores decouple once the model starts fitting noise: training error keeps falling while the error on new data rises." }
  ]
}
// response, mid-conversation
{
  "done": false,
  "understanding": 47,
  "question": "Wait — I thought Overfitting means the data was dirty. Why is that not right?",
  "targeted_misconception_id": "overfitting_is_bad_data",
  "turns_remaining": 2,
  "result": null
}
// response, final turn — `result` is the same ExplainOut the one-shot endpoint returns
{ "done": true, "understanding": 100, "question": null, "targeted_misconception_id": null, "turns_remaining": 0,
  "result": { "score": 100, "verdict": "pass", "xp_awarded": 25, "feedback": "The student gets it now — you answered every follow-up and left no gaps.", "misconception_id": null, "concept": { "id": "overfitting", "label": "Overfitting", "summary": "…" }, "world_xp": 62, "server_xp": 62 } }
```

- `role` is `learner` (the player) or `student` (the AI). **Only `learner` turns are scored** — `student` turns are context for the next question and can never earn XP.
- Transcript limits (all `422`): at most 12 turns, 1200 chars per turn, 8000 chars total, the **last turn must be the learner's**, and the learner's combined text must be at least 20 chars.
- `understanding` is 0–100, the same scale as `ExplainOut.score`; drive the meter from it. `turns_remaining` counts the learner turns left before the student stops asking (max 4), so the ending never looks arbitrary.
- `question` is `null` exactly when `done` is `true`. `targeted_misconception_id` is set when the question is aimed at a known misconception, so you can highlight it.
- **Nothing is written until `done`.** Abandoning a chat stores nothing and earns nothing. On the final turn the server writes one explanation (the rendered transcript) plus one attempt and returns `result` — same XP rules as `/explain`: 25 pass / 10 partial, first pass or partial per concept per world only, later conversations return `xp_awarded: 0`.
- `409` if the world is not ready, `404` for an unknown `concept_id`, `503` if the grader is unavailable (live-model path only; the fixture student never fails) — offer retry, which re-posts the identical body.

## Content contract (what you render)

Full JSON Schemas: `schema/course-graph.schema.json`, `schema/game.schema.json`. Hand-written fixtures:
`fixtures/pybasics.{graph,quest,gauntlet}.json` and `fixtures/overfitting.{graph,quest,gauntlet}.json`, each with
the lecture text its `source_spans` quote (`pybasics_lecture.txt`, `demo_lecture.txt`). All copied into
`frontend/src/fixtures/`; `scripts/check-fixtures-sync.sh` fails CI if the two copies diverge, and
`python3 schema/validate.py` checks every bundle against its own graph.

### CourseGraph (`world.graph`)
```
CourseGraph { schema_version:"1.0", graph_id, source:{title, segment_count}, concepts: Concept[] }
Concept     { id, label, summary, bloom_level, prerequisites: id[], source_spans: SourceSpan[], misconceptions: Misconception[] }
Misconception { id, statement, why_plausible, correction }
SourceSpan  { segment_id, quote }
bloom_level: remember | understand | apply | analyse | evaluate | create
```
Use the graph for the concept map / progress screens (prerequisites = edges) and for the Explain to Win concept picker.

### Game (`world.games.quest` / `world.games.gauntlet`)
```
Game    { schema_version:"1.0", game_id, graph_id, archetype: quest|gauntlet, title, chapters: Chapter[] }
Chapter { id, title, concept_ids, background, scenes: Scene[] }        // 1–8 scenes, play in order
Scene   = DialogueScene | PredictionScene | SimulationScene             // discriminate on `type`
```

| Scene `type` | Fields | What to render |
|---|---|---|
| `dialogue` | `id, speaker, props?, lines[1–4]` | Speech bubbles from `speaker`. `mentor_owl` = the server's `pet` mascot. |
| `prediction` | `id, concept_id, props?, prompt, options[3–4], reveal` | Prompt + option buttons. On pick → `POST /attempts`, then show `reveal` (always) and the misconception `correction` (if wrong). |
| `simulation` | `id, concept_id, widget, instruction, success_condition?` | The hand-built widget named by `widget`. No attempt posted (no options). |

Option rule: `{ id, text, correct, misconception_id? }` — **incorrect options carry `misconception_id`; the correct one never does.** Exactly one correct option per prediction scene. The client can use `correct` for offline/fixture rendering, but in the real flow the server's `AttemptOut.correct` is the answer of record.

Fixed vocabularies (the model picks names, the FE owns the art):

| Enum | Values |
|---|---|
| `background` | `cavern`, `forest_path`, `ruins`, `observatory`, `shore`, `village` |
| `speaker` (actor) | `explorer`, `mentor_owl`, `rival`, `villager` |
| `props` | `doorway_pair`, `chart_frame`, `lantern`, `crystal_cluster`, `chest`, `signpost` |
| `widget` | `curve_fit`, `threshold_slider`, `sorting_bins`, `graph_walk` |

Quest and gauntlet from the same world share `graph_id` (`wk3ml0a1` in the fixtures). Quest = narrative, long form, all three scene types. Gauntlet = one chapter of rapid prediction scenes (`g_overfit`, `g_regularisation`, …) over the same concepts.

## Gotchas

- **Passwords must clear the policy in `backend/app/services/passwords.py`**: at least 10 characters, not a common password (the blocklist sees through `P@ssw0rd1!` and `password2024`), and not containing the user's own email local part or display name. No composition rule. A failure is a 422 whose `msg` is the user-facing sentence. `POST /auth/login` has no policy, so accounts predating it still work.
- **`detail` may be a string or a list.** App errors: `{"detail": "invalid credentials"}`. Validation errors (422): `{"detail": [{"loc": ["body", "password"], "msg": "String should have at least 10 characters", "type": "string_too_short"}]}`. `ApiError.detail` carries it as-is; `ApiError.message` is the string form or `API error <status>`.
- **Poll `GET /servers/{id}` every 2 s until `status` is `ready` or `failed`.** Do not poll faster. `pollServer(id, onTick)` returns a cancel function — call it on unmount.
- **`games.gauntlet` can be `null` independently** of `games.quest` on a `ready` world (degraded mode when gauntlet generation failed). Hide the Conquest/boss entry, do not crash.
- **The client never sends `correct`.** The server grades `option_id` against the stored game JSON.
- **XP only on the first attempt per scene** (per user, world, scene). Repeats are stored with `xp_awarded: 0`. Correct 10 XP, wrong 2 XP, explain pass 25 / partial 10.
- **The server `pet` is the mascot** that asks the questions: render it whenever a dialogue `speaker === "mentor_owl"`. It is a free string (≤ 32 chars); the design decides the sprite set. Users have no pet.
- **Lives and timer for the gauntlet are frontend-only.** The API only records attempts.
- **`join_code` is omitted on `GET /servers/public`** (type is `join_code?: string`). It is present on `GET /servers` and `GET /servers/{id}` for members.
- **CORS allows `http://localhost:5173`** (Vite default port, fixed in `vite.config.ts`) and the prod web origin. Other origins get blocked by the browser, not a 4xx.
- `is_public` in the multipart form is the string `"true"`/`"false"`.
- IDs are 32-char uuid hex; content ids (`concept_id`, `scene_id`, `option_id`) are slugs `^[a-z0-9_]{2,48}$`; `graph_id`/`game_id` are `^[a-z0-9]{8,32}$`.
- Timestamps are ISO-8601 UTC strings (`2026-08-22T09:15:00Z`).
- The FE dev has no Python: build against the deployed API plus `frontend/src/fixtures/`. Once the API is up, `OPENAPI_SOURCE=https://api.classquest.net/openapi.json npm run gen:api` regenerates `src/api/types.gen.ts`; until then `src/api/types.ts` is the contract.
