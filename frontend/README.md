# ClassQuest frontend

Vite + React 19 + TypeScript + Tailwind 3. The API contract lives in `../CONTRACTS.md`.

```sh
npm install
npm run dev        # http://localhost:5173, /api proxied to VITE_API_PROXY || http://localhost:8000
npm run typecheck  # tsc --noEmit
npm run lint       # oxlint
npm run build      # tsc -b && vite build -> dist/
npm run gen:api    # OPENAPI_SOURCE=<api>/openapi.json -> src/api/types.gen.ts
```

Layout:

- `src/api/types.ts` — hand-written contract types (API DTOs + CourseGraph/Game content). Replace with `types.gen.ts` once the API is deployed.
- `src/api/client.ts` — `api.*` typed fetch wrapper, `ApiError`, `getToken`/`setToken` (`localStorage["cq_token"]`).
- `src/api/poll.ts` — `pollServer(id, onTick)` until `ready | failed`.
- `src/fixtures/` — the three content fixtures, typed; build the renderer offline against these.
- `src/App.tsx` — wiring proof only; replace it.

Env: copy `.env.example` to `.env`. Leave `VITE_API_URL` unset in dev to use the proxy; in prod it is a Docker build-arg.
