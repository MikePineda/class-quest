# Operations

Everything you need to deploy, debug and demo ClassQuest. If you are picking this repo up
cold, read this after `README.md` and `CONTRACTS.md`.

## Live

| What | Where |
|---|---|
| Frontend | https://classquest.net |
| API | https://api.classquest.net |
| API docs (Swagger) | https://api.classquest.net/docs |
| OpenAPI schema | https://api.classquest.net/openapi.json |
| Dokploy panel | https://dokploy.mikepineda.work → project `classquest` |

Demo account seeded on first boot: `demo@classquest.app` / `demo1234`.
Public demo server join code: `DEMO01` (the hand-written overfitting world — this is the
pitch's Plan B and it works with no LLM key at all).

## Deploy

Push to `main` → Dokploy's GitHub webhook builds and deploys. GitHub Actions runs the
checks but does **not** deploy; the two race, and that is deliberate so a red lint can
never block a demo fix.

Two Dokploy Applications, both from `MikePineda/class-quest`, branch `main`, auto-deploy on:

| App | Dockerfile | Build context | Target stage | Port | Domain |
|---|---|---|---|---|---|
| `classquest-api` | `backend/Dockerfile` | `.` (repo root) | `runtime` | 8000 | api.classquest.net |
| `classquest-web` | `frontend/Dockerfile` | `frontend` | `serve` | 80 | classquest.net |

- **The API build context is the repo root on purpose**: the image needs `schema/` and
  `fixtures/` next to the app.
- **Volume**: `classquest-data` → `/data` on the API app. Holds the SQLite database and
  uploads. Mount it *before* the first deploy of a fresh app or the demo data dies on the
  next redeploy. (The seed is idempotent, so even a wiped volume rebuilds the demo server.)
- **TLS**: Cloudflare proxied, with a Cloudflare Origin Certificate for
  `classquest.net & *.classquest.net` uploaded in Dokploy → Settings → Certificates.
  Both domains use `https: true` with `certificateType: none`; Traefik serves the uploaded
  cert by SNI. Keep both apps on HTTPS — a mixed HTTP/HTTPS pair means the browser blocks
  every API call and it looks like a code bug.
- **Changing the domain** is four fields and zero code: the two Dokploy domain entries,
  `CORS_ORIGINS` and `PUBLIC_API_URL` on the API, and the `VITE_API_URL` build arg on the
  web app (then redeploy the web app — Vite inlines it at build time).

### Two deploy traps that already cost us an hour

**1. Dokploy always passes `--target`.** An unnamed final stage fails the build with
`flag needs an argument: --target` in about a second. Both Dockerfiles name their final
stage (`runtime`, `serve`) and the Dokploy apps point at those names. If you add a stage,
keep the last one named.

**2. A list-typed setting cannot be read from the environment.** pydantic-settings
JSON-decodes the env value for a `list[str]` field *before* any validator runs, so a
comma-separated `CORS_ORIGINS` raised `SettingsError` at import time and the container
crash-looped with a 502 at the edge. `Settings.cors_origins_raw` is a plain `str` and the
split lives in the `cors_origins` property. Do the same for any future list setting.

### API environment

Set in the Dokploy panel (never in the repo). Names are the uppercase of the fields in
`backend/app/config.py`; `backend/.env.example` documents every one.

```
DATA_DIR=/data
JWT_SECRET=<openssl rand -hex 32>
CORS_ORIGINS=https://classquest.net,https://www.classquest.net,http://localhost:5173
PUBLIC_API_URL=https://api.classquest.net
LLM_API_KEY=<minimax key>          # empty = fixture mode, the app still works
LLM_BASE_URL=https://api.minimax.io/anthropic
LLM_MODEL=MiniMax-M3
SEED_DEMO=true
```

`GET /health` reports `llm: "live"` when a key is set and `llm: "fixtures"` when it is not.
That field is the fastest way to tell which mode production is in.

### Handing the link to strangers

`JWT_SECRET` must be a real random value in the panel. The app logs a warning at startup when
it is still the dev default, and it will happily run that way — every session token in the wild
would then be forgeable by anyone who has read this repo.

The abuse controls all default to their production values, so a deployment that sets none of
them is still defended. They exist because `POST /servers` starts a thread that makes dozens of
model calls, so an unbounded sign-up page is an unbounded bill:

```
RATE_LIMIT_ENABLED=true            # only the test suite turns this off
TRUST_FORWARDED_FOR=true           # true behind Traefik; false if nothing proxies the app
MAX_SERVERS_PER_USER=5
MAX_CONCURRENT_GENERATIONS=3
```

`TRUST_FORWARDED_FOR` decides where the caller's address is read from. Behind Traefik the
socket peer is the proxy, so the address comes from the **rightmost** `X-Forwarded-For` hop —
the one the proxy appended and the only one a caller cannot write themselves. With nothing in
front of the app that header is pure attacker input and this must be `false`.

The limits are sized so a full classroom behind one NAT never sees a `429`: registering,
signing in and joining are per address and loose, creating a course and grading an explanation
are per **account**, and the public demo chat is per address *and* under a global ceiling. They
are counted in this process, which is correct only because uvicorn runs `--workers 1`. A second
worker makes every number per-worker; see the note at the top of `backend/app/ratelimit.py`.

Two things to know when watching the box during a demo:

- a `503` from `POST /servers` is the generator at capacity, not a crash. It clears on its own.
- `POST /demo/explain/turn` is the only unauthenticated endpoint that reaches the model. It
  loads its concept from `fixtures/` on the box, so it cannot be pointed at a caller's own
  prompt, and it writes nothing.

## The LLM

MiniMax is reached through the `anthropic` SDK pointed at MiniMax's Anthropic-compatible
endpoint. Three things are load-bearing:

- The key goes in **`api_key`** (an `x-api-key` header), never `auth_token` — a Bearer
  header comes back 401 on every call.
- `max_retries=1`. These calls already sit behind a 120s timeout in a background thread.
- The model wraps JSON in prose and fences no matter how loudly you ask it not to.
  `services/llm.py` prefills the assistant turn with `{`, then walks fences, prose, nested
  braces and trailing commas, then makes exactly one repair call before giving up.

**Empty key is a supported mode, not a broken one.** The pipeline serves the hand-written
fixtures instead, and CI runs that path on every push, so the demo survives a dead key,
a rate limit, or no network.

## Smoke tests

```bash
# 1. Is the model reachable and is our parsing sane? (~3s)
cd backend && .venv/bin/python -m scripts.llm_spike

# 2. Is production alive and in which mode?
curl -s https://api.classquest.net/health

# 2b. Does the signed-out demo chat answer? (no account, awards nothing)
curl -s -X POST https://api.classquest.net/demo/explain/turn -H 'Content-Type: application/json' \
  -d '{"bundle":"pybasics","concept_id":"variables","turns":[{"role":"learner","text":"A variable is a name bound to a value in memory."}]}'

# 3. Full user journey against production (register -> create -> poll -> play -> leaderboard)
#    The sequence is in README.md.

# 4. Local checks, the same ones CI runs
cd backend && .venv/bin/ruff check . && .venv/bin/pytest
python3 schema/validate.py
bash scripts/check-fixtures-sync.sh
cd frontend && npm run typecheck && npm run lint && npm run build
```

## What generation actually does

`POST /servers` ingests synchronously (a few seconds) and returns `status: "processing"`,
then a daemon thread runs the pipeline and the frontend polls `GET /servers/{id}` every 2s.

One "planner" call splits the segments into worlds — roughly one world per six segments,
capped by `MAX_WORLDS`. Then per world, three calls: graph, quest, gauntlet. Each artifact
goes through validate → autorepair → one repair call → validate before it is stored.

Budget about **10–15s per call**, so a 14-segment lecture is 2–3 worlds and 6–9 calls,
roughly 1.5–2 minutes. Progress is committed after every artifact, so the map fills in as
it goes rather than appearing all at once. **A world that fails does not sink the others**;
its `error` field names the stage that died, and the server still reaches `ready` if at
least one world made it.

For a live demo, upload something small. Beat one should be a pre-generated server you
never touch again.

## Debugging a deploy

```bash
# Which containers are actually running?
ssh mikecrosoft "docker service ls --filter name=classquest"

# Why did the task die? (crash-loops show here, not in the build log)
ssh mikecrosoft "docker service ps classquest-api-erentk --no-trunc" 
ssh mikecrosoft "docker service logs classquest-api-erentk --tail 50"

# Build logs (git clone noise dominates; filter it)
ssh mikecrosoft "ls -t /etc/dokploy/logs/classquest-api-erentk/ | head -1"
ssh mikecrosoft "grep -v 'objects\|deltas\|^remote:' /etc/dokploy/logs/classquest-api-erentk/<file> | tail -30"
```

A build that fails in ~1 second is a configuration error, not a code error. A build that
succeeds while the service stays at `0/1` replicas is a startup crash — read the service
logs, not the build log.

## Repository conventions

- `main` is deployed. Work on a branch, open a PR.
- The content contract (`schema/*.schema.json`) is the law; generated content is validated
  against it before it is stored. Never loosen the schema to make an artifact pass.
- Fixtures live in `fixtures/` and are mirrored into `frontend/src/fixtures/`. CI fails if
  they drift; `npm --prefix frontend run sync:fixtures` resyncs them.
- No course material in the repo (`*.pdf`, `*.pptx`, `*.docx`, `course-input/` are ignored).
- Secrets only in `backend/.env` (git-ignored) and the Dokploy panel.
