# ClassQuest

**Learn by playing.** Upload lecture notes, slides or transcripts; ClassQuest extracts a
learning-objective graph (concepts, prerequisites, misconceptions) and builds playable worlds
from it: a story-driven **Quest**, a timed **Gauntlet**, and **Explain to Win**.

Minecraft analogy: you create or join a **server** (a class) with a join code; a server holds
several **worlds** (one per topic cluster of the uploaded material); every world has the three modes.

## Repo layout

| Path | What |
|---|---|
| `backend/` | FastAPI + SQLite API. `app/routers` (HTTP), `app/services` (ingest, LLM, validation, generation) |
| `frontend/` | Vite + React + TS + Tailwind. `src/api/` is the typed client; screens live above it |
| `schema/` | The content contract (JSON Schema) + `validate.py` |
| `fixtures/` | Hand-written demo content (overfitting) seeded as the public demo server |
| `CONTRACTS.md` | API contract for the frontend, with JSON examples |
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

Demo login after first boot: `demo@classquest.app` / `demo1234`, public server join code `DEMO01`.

## Tests and checks

```bash
cd backend && .venv/bin/ruff check . && .venv/bin/pytest
cd frontend && npm run typecheck && npm run lint && npm run build
python3 schema/validate.py           # fixtures vs contract
```

## Deploy

Push to `main` → Dokploy builds and deploys two apps (`backend/Dockerfile` with repo-root
context, `frontend/Dockerfile` with the `VITE_API_URL` build arg). GitHub Actions runs the
checks above but does not deploy. Domains, secrets and CORS origins are environment only.

Setting a real LLM key: `LLM_API_KEY` in `backend/.env` locally and in the Dokploy env panel.
Smoke test: `cd backend && .venv/bin/python -m scripts.llm_spike`.
