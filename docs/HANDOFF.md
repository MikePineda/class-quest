# Handoff — portal hub

State as of PR #15 (`feat/playable-world`, 18 commits). Everything below is verified,
not assumed. Read `docs/OPERATIONS.md` for deploy and `CONTRACTS.md` for the API.

## What the world is now

The player stands in the middle of a cavern hub. Three portals lead into three ways of
learning the same course, plus a fourth that renders sealed.

Two hand-written worlds ship compiled into the page (Python basics, overfitting), so the
app is walkable with no account and no API — that is what the login screen offers.

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

Login `demo@classquest.app` / `demo1234`. Two servers are seeded, one `ready` world each:
Programming Fundamentals (`PY101A`) and Intro to ML (`DEMO01`). Both have a quest, a
gauntlet and a graph — enough to exercise all three portals — and both have a ten-strong
cohort so the leaderboards are not empty. `frontend/.env.bak` holds the previous proxy
value; flip back to `https://api.classquest.net` to see real generated worlds.

The bundled routes `/world?demo=pybasics` and `/world?demo=overfitting` need no account
and no API, and the login screen's "Walk the demo world" opens the first of them. They
have **no world id**, so the Explain portal cannot post there and says so. Use a real
world id to test the chat.

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
5. **The scripted `/demo` encounter is no longer the login CTA.** It is still routed and
   still works, but nothing prominent links to it — the button that used to promised a
   world and delivered a reducer. Decide whether it earns its keep.
6. **`worldgen.ts` and `worldgen.test.ts` are dead.** Kept green on purpose so CI never went
   red mid-redesign. Deleting them is a five-minute cleanup; `WorldCanvas` also still has the
   scene-node marker path, inert with `nodes: []`.
7. **Two lint warnings** in `SceneStages.tsx` (`react(only-export-components)`) because
   `humanise` and `filled` live beside components. Moving them to a helper module clears it.
8. **`Room.chapterId` / `Room.title`** are named after chapters and a hub has none. Renaming
   costs a three-file sweep and was not worth it mid-build.

## Traps that already cost time — do not rediscover them

- **There is a router now, and `WorldExperience` needs `key={worldId}`.**
  `openPortal` and `committing` are the only pieces of world state not keyed by
  world id. Without the remount, leaving world A with the quiz open lands the
  learner *inside world B's quiz*, having never seen its map. Full page loads
  used to hide this completely.
- **The click interceptor must select `'a'`, never `'[href]'`.** React 19 hoists
  `<style href=…>` out of the components that declare them, and the novel shell
  uses that — so `[href]` matches stylesheets.
- **`useSyncExternalStore`'s `getSnapshot` must return a cached object.** A fresh
  literal per call is an infinite render loop. `nav/router.ts` rebuilds `current`
  only inside `emit`.
- **Never set a transform in the style prop and also write it imperatively.** The
  thumbstick knob did both, and since the world re-renders on every tile change,
  React reapplied the prop and snapped the knob back to centre mid-drag. The
  handler is the only owner; a fresh gesture mounts a fresh knob.
- **`pollServer` swallows five consecutive failures before reporting.** Never use
  it for the opening fetch on a screen that can 403 or 404 — it sits on
  "Loading…" for ten seconds and then calls a permission error a network blip.
  `ServerScreen` does one plain `getServer` first and only then hands off.
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

## Mobile

The world is playable on a phone. Three things were keyboard-only — walking,
opening a gate and leaving — and every panel behind a gate was already tappable,
because its choices, page turns and close button are real buttons.

- **`frontend/src/scene/input.ts` is pure and has a golden test.** It asserts the
  new vector maths is bit-identical to the pre-joystick expression across all 256
  combinations of the eight movement keys. Touch was only ever allowed to be free.
  If you change movement, that test is the contract.
- **`resolveIntent` divides by `max(1, hypot)`.** For keys that *is* `hypot` —
  they are sums of -1, 0 and 1, so the length is never below 1. For an analog
  vector shorter than 1 it divides by 1, which is what makes a small tilt a slow
  walk. Key plus stick saturates at 1, so touch cannot outrun the keyboard.
- **The analog ref must be zeroed in four places**: map change, blur, portal open,
  unmount. Each is a way a gesture can end without a pointerup. Miss one and the
  player walks into a wall forever.
- **`pickScale` is floored at fourteen tiles across** (`scene/camera.ts`). Before
  that, covering the map could overrule the framing and a 412x915 phone showed
  6.4 tiles of a 28-tile room with both gates off screen. Portrait letterboxes
  instead; the band is the same `#05080f` the vignette already fades the edges
  to, so it reads as the cave going dark. Desktop scales are pinned as literals
  in `camera.test.ts` — 1280x720 is 3, 1920x1080 is 5, 2560x1440 is 6.
- **Do not make the hub size depend on the viewport.** `usePlayer` and
  `WorldCanvas`'s preload are both keyed on `map` identity, so it would reset the
  player to spawn and re-run the preloader on every rotation.
- **`touch-action: none` belongs on the `WorldCanvas` wrapper, not the world
  root.** The portal panels are siblings of that wrapper, not descendants, so
  they keep scrolling normally.
- **`100vh` is the *large* viewport on iOS.** With the toolbar showing, the
  document is taller than the screen and every drag on the canvas scrolls the
  page instead of steering. `dvh` on `body` and on the world root.
- **Gate hints on `useCoarsePointer()`, never a breakpoint.** `sm:` is a width
  query, so a tablet in portrait used to be told to press WASD.
