# ClassQuest

**Learn by playing.** Upload lecture notes, slides or transcripts; ClassQuest extracts a
learning-objective graph (concepts, prerequisites, misconceptions) and builds playable worlds
from it: a story-driven **Quest**, a timed **Gauntlet**, and **Explain to Win**.

Minecraft analogy: you create or join a **server** (a class) with a join code; a server holds
several **worlds** (one per topic cluster of the uploaded material); every world has the three modes.

**Live:** [classquest.net](https://classquest.net) · API [api.classquest.net](https://api.classquest.net)
([Swagger](https://api.classquest.net/docs)) · demo login `demo@classquest.app` / `demo1234`,
public server join code `DEMO01`.

## Repo layout

| Path | What |
|---|---|
| `backend/` | FastAPI + SQLite API. `app/routers` (HTTP), `app/services` (ingest, LLM, validation, generation) |
| `frontend/` | Vite + React + TS + Tailwind. `src/api/` is the typed client; screens live above it |
| `schema/` | The content contract (JSON Schema) + `validate.py` |
| `fixtures/` | Hand-written demo content (Python basics, overfitting), seeded as two public demo servers and compiled into the frontend |
| `CONTRACTS.md` | API contract for the frontend, with JSON examples |
| `docs/OPERATIONS.md` | **Deploy, environment, smoke tests, debugging — read this before touching prod** |
| `docs/ATTRIBUTION.md` | Where the sprites come from, the licence terms, and how to re-cut them |
| `docs/` | Proposal, research notes, alignment deck |

## Run it

```bash
# backend  → http://localhost:8000/docs
cd backend && python3.12 -m venv .venv && .venv/bin/pip install -r requirements.txt
cp .env.example .env            # LLM_API_KEY empty = fixture mode (no network)
.venv/bin/uvicorn app.main:app --reload

# frontend → http://localhost:5173  (proxies /api → :8000)
cd frontend && npm install && npm run dev

# or both in docker
docker compose up --build
```

Demo login after first boot: `demo@classquest.app` / `demo1234`, public server join codes `PY101A`
(Programming Fundamentals) and `DEMO01` (Intro to ML). No account needed for the bundled worlds:
`/world?demo=pybasics` and `/world?demo=overfitting` walk without touching the API.

## Tests and checks

```bash
cd backend && .venv/bin/ruff check . && .venv/bin/pytest
cd frontend && npm run typecheck && npm run lint && npm run build
python3 schema/validate.py           # fixtures vs contract
```

## Deploy

`main` is deployed: work on a branch and open a PR. On merge, Dokploy builds and deploys two apps (`backend/Dockerfile` with repo-root
context, `frontend/Dockerfile` with the `VITE_API_URL` build arg). GitHub Actions runs the
checks above but does not deploy. Domains, secrets and CORS origins are environment only.

Setting a real LLM key: `LLM_API_KEY` in `backend/.env` locally and in the Dokploy env panel.
Smoke test: `cd backend && .venv/bin/python -m scripts.llm_spike`.

Full operational detail — build contexts, the volume, TLS, the two deploy traps that have
already bitten us, and how to read a failed deploy — is in [`docs/OPERATIONS.md`](docs/OPERATIONS.md).
