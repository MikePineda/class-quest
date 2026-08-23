# Handoff — portal hub

State as of PR #15 (`feat/playable-world`, 18 commits). Everything below is verified,
not assumed. Read `docs/OPERATIONS.md` for deploy and `CONTRACTS.md` for the API.

## What the world is now

The player stands in the middle of a cavern hub. Three portals lead into three ways of
learning the same course, plus a fourth that renders sealed.

| Portal | Reads | Server-backed? |
|---|---|---|
| 📖 Storybook | `CourseGraph.concepts[]` | no — read receipts are local only |
| ❓ Quiz | `WorldDetail.games.gauntlet` | answers yes, threshold no |
| 💬 Explain to Win | `POST /worlds/{id}/explain/turn` | yes, fully |
| 🔒 Sealed | nothing | n/a |

`schema/` was not touched. The backend gained exactly one endpoint.

## Running it locally

Two servers. The deployed API does **not** have `/explain/turn` until this PR ships, so
`frontend/.env` was pointed at a local backend:

```bash
cd backend && .venv/bin/uvicorn app.main:app --reload   # :8000, seeds a demo world
cd frontend && npm run dev                              # :5173, proxies /api -> :8000
```

Login `demo@classquest.app` / `demo1234`. The seeded world has a quest, a gauntlet and a
graph — enough to exercise all three portals. `frontend/.env.bak` holds the previous
value; flip back to `https://api.classquest.net` to see real generated ML worlds, but the
chat portal will 404 there until this is deployed.

The fixture route `/world?demo=1` has **no world id**, so the Explain portal cannot post
there and says so. Use a real world id to test the chat.

## Known open items

Nothing here is broken; these are the things deliberately left.

1. **The Explain guide (the owl) can sit off the right edge.** The guide offset is a fixed
   `+2` tiles in `hubgen.ts`; on the right-hand portal that pushes it against the wall.
   Mirror it inward per slot.
2. **Simulation scenes are a labelled placeholder.** `widget` values (`curve_fit`,
   `threshold_slider`, …) render as a name and an instruction. Only the quest carries
   them, and the quest is no longer walkable, so nothing reaches this today.
3. ~~The live model path for the chat is not built.~~ **Built.** `socratic.next_turn` calls
   the model through `llm.call_json` with `prompts.socratic_prompt`, and falls back to
   `fixture_turn` on `FixtureMode`, `LLMError` and `LLMFormatError` — unlike
   `explain.grade_explanation`, which answers 503. Production runs with a live key
   (`/health` reports `llm: "live"`); a turn takes about three seconds.
4. **The boss bar was cut.** Design decided: derive it read-only from `GET /servers/{id}/cohort`,
   which already returns per-scene distributions — zero backend work — and **never** let it
   gate anyone's progress.
5. **`worldgen.ts` and `worldgen.test.ts` are dead.** Kept green on purpose so CI never went
   red mid-redesign. Deleting them is a five-minute cleanup; `WorldCanvas` also still has the
   scene-node marker path, inert with `nodes: []`.
6. **Two lint warnings** in `SceneStages.tsx` (`react(only-export-components)`) because
   `humanise` and `filled` live beside components. Moving them to a helper module clears it.
7. **`Room.chapterId` / `Room.title`** are named after chapters and a hub has none. Renaming
   costs a three-file sweep and was not worth it mid-build.

## Traps that already cost time — do not rediscover them

- **`portalSpecs` must stay memoised.** A fresh array literal makes a new `WorldMap` every
  render, which resets the player to spawn (looks like "movement is broken") *and* keeps the
  canvas preload from ever settling (looks like "the world never loads"). Neither symptom
  points at the cause. The same applies to anything else flowing into `WorldCanvas`.
- **Quiz attempts post `archetype: 'gauntlet'`.** The server resolves an attempt by world,
  archetype and scene id. Posting `quest` grades against a scene that does not exist.
- **The hub must emit exactly one `Room`.** `WorldCanvas.buildRoomIndex` assigns unclaimed
  tiles to the nearest room centre; a second room blacks out everything outside both rects.
  There is a test asserting this.
- **No Alembic, and `main.py` only calls `create_all()`**, which does not alter an existing
  table. A new column no-ops against the deployed SQLite and then 500s on first insert. This
  is why the chat keeps no server state.
- **`vite.config.ts` needs `loadEnv`.** Vite never puts `VITE_*` on `process.env`, so the dev
  proxy setting in `frontend/.env` is ignored without it. Fixed, but easy to undo.

## Rules that were set and should hold

- **Learner-facing copy carries no internal vocabulary.** Not `gauntlet`, `archetype`,
  `misconception`, `source span`, `verdict`, `diagnosis`, `concept_id`. Those are schema and
  architecture words. Naming a *concept* is fine — that is the learner's own material.
  The owner rejected a screen for this once already.
- **Never fabricate pedagogical text.** If `why_plausible` is empty the panel is omitted, not
  filled. Real generated content is thin — a few hundred characters per concept, sometimes no
  source quote at all — and inventing connective prose invents course material.
- **Locking in an answer is a separate, deliberate act.** Revealing on selection turns the
  whole thing back into an ordinary quiz; committing before the answer appears is the
  mechanism.
- **Nothing that must be true may hang off a portal clear.** XP is only ever the server's
  `xp_awarded`. `frontend/src/scene/gating.ts` has the full honesty note at the top.

## Two bugs that only real content revealed

Worth remembering because fixtures hid both:

- Misconception ids resolve **across the whole graph**, not just the scene's concept. In a real
  quest, 4 of 12 wrong options carried a belief owned by a neighbouring concept — the
  cross-concept boundary confusions, which are the most interesting ones — and a third of wrong
  answers were diagnosing nothing at all.
- `mastered` requires **correct answers**, not visits. Walking every scene and getting them all
  wrong used to read as "Mastered".

Test against a real generated world, not only `fixtures/`.

## Two more that only real content revealed

- **No gauntlet scene declares a prop.** Not one, in any world on the deployed server. Props
  live only on quest scenes, so `SceneIllustration` had nothing to draw and `chart_frame` —
  the one prop drawn in code rather than blitted — reached no screen at all. A question now
  inherits the props its concept was given in the quest; see `frontend/src/scene/conceptProps.ts`
  for exactly what is and is not carried across.
- **The quest is unreachable.** Since the hub redesign the storybook reads the graph, the quiz
  reads the gauntlet and the chat reads the graph. `games.quest` is loaded and used for the
  world title and nothing else, so its dialogue, its simulations and its props are dead weight
  on the wire. Worth deciding deliberately rather than inheriting.
- **`WorldSummary.my_completion` counts scenes *attempted*, not answered correctly.** Anything
  built on it must say "walked", never "mastered". Mastery is `best_correct`.
