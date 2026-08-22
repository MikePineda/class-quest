# ClassQuest — agent rules

Hackathon project: turn course content into playable worlds. Read `CONTRACTS.md` (API for the
frontend) and `schema/README.md` (content contract) before touching code.

## Non-negotiables
- `schema/course-graph.schema.json` and `schema/game.schema.json` are the law. Generated content is
  validated against them (`backend/app/services/validators.py`) before it is persisted. Never
  "fix" a failing artifact by loosening the schema.
- No code copied from prior personal projects (hackathon rule). Write fresh; patterns are fine.
- No course material in the repo: `*.pdf`, `*.pptx`, `*.docx`, `course-input/` are gitignored.
- Secrets only in `backend/.env` (gitignored) and in the Dokploy panel. Empty `LLM_API_KEY`
  means fixture mode and must keep working — CI runs that path.
- No domain names in source. Domains live in env vars and the `VITE_API_URL` build arg.

## Backend (`backend/`)
- FastAPI + SQLAlchemy 2 + SQLite (WAL), Python 3.12, plain pip. One file per concern, no layers:
  `routers/` (thin), `services/` (logic), `models.py`, `schemas.py` (DTOs with examples),
  `contracts.py` (pydantic mirrors of the JSON schemas, for `/openapi.json`).
- Sync endpoints. uvicorn runs with `--workers 1` on purpose (SQLite + in-process generation thread).
- Models have no `relationship()`s: flush parent rows before inserting children.
- Timestamps are ISO-8601 UTC strings (`ids.utc_now_iso`), ids are uuid hex; artifact ids
  (`graph_id`, `game_id`) are minted server-side with `ids.artifact_id()`, never by the model.
- MiniMax is reached through the `anthropic` SDK with `api_key=` (x-api-key). Never `auth_token`.
- Settings read from the environment must not be typed as `list`/`dict`: pydantic-settings
  JSON-decodes those before any validator runs, which crash-looped production once. Keep the
  raw value a `str` and expose a parsed property (see `cors_origins`).
- TDD on pure modules (ingest, validators, llm parsing, scoring). `cd backend && .venv/bin/ruff check . && .venv/bin/pytest`.

## Frontend (`frontend/`)
- Vite + React + TS + Tailwind 3. The FE dev owns everything above `src/api/`.
- `src/api/client.ts` is the only place that talks HTTP. `src/api/types.gen.ts` is generated
  from the deployed OpenAPI schema (`npm run gen:api`); `src/api/types.ts` is the hand-written
  mirror the client still imports. Regenerate whenever the backend contract changes.

## Git
- Atomic commits, one logical change each, imperative subject, short body with the why.
- `main` is deployed and protected: branch, PR, merge. CI (`.github/workflows/`) guards merges;
  Dokploy deploys on merge via webhook.
- Both Dockerfiles must keep a **named** final stage: Dokploy always passes `--target`.
- Deploy/debug runbook: `docs/OPERATIONS.md`.

## Run
```
cd backend && python3.12 -m venv .venv && .venv/bin/pip install -r requirements.txt
cp .env.example .env && .venv/bin/uvicorn app.main:app --reload        # http://localhost:8000/docs
cd frontend && npm install && npm run dev                               # http://localhost:5173
docker compose up --build                                               # both, local
```
