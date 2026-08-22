// Wiring proof, not a real UI: login -> list my servers -> dump a server, plus an
// offline fixture render. The FE dev replaces this file entirely.
import { useState, type FormEvent } from 'react'
import { api, ApiError, getToken, setToken } from './api/client'
import type { PredictionScene, ServerDetail, ServerSummary } from './api/types'
import { fixtureQuest } from './fixtures'

const firstPrediction = fixtureQuest.chapters
  .flatMap((c) => c.scenes)
  .find((s): s is PredictionScene => s.type === 'prediction')!

const errText = (e: unknown) => (e instanceof ApiError ? JSON.stringify(e.detail) : String(e))

export default function App() {
  const [email, setEmail] = useState('demo@classquest.app')
  const [password, setPassword] = useState('demo1234')
  const [authed, setAuthed] = useState(() => getToken() !== null)
  const [servers, setServers] = useState<ServerSummary[]>([])
  const [detail, setDetail] = useState<ServerDetail | null>(null)
  const [useFixtures, setUseFixtures] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = (p: Promise<unknown>) => p.catch((e) => setError(errText(e)))

  const loadServers = () => run(api.listServers().then((r) => setServers(r.servers)))

  const auth = (e: FormEvent, mode: 'login' | 'register') => {
    e.preventDefault()
    setError(null)
    const call =
      mode === 'login' ? api.login({ email, password }) : api.register({ email, password, display_name: email.split('@')[0] })
    run(call.then((t) => (setToken(t.token), setAuthed(true), loadServers())))
  }

  const input = 'w-full rounded-lg bg-surface-high px-3 py-2 text-ink outline-none ring-outline focus:ring-1'
  const btn = 'rounded-lg bg-primary px-3 py-2 font-semibold text-background hover:bg-primary-soft'

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-6">
      <h1 className="text-2xl font-bold text-primary">ClassQuest wiring proof</h1>
      <label className="flex items-center gap-2 text-ink-muted">
        <input type="checkbox" checked={useFixtures} onChange={(e) => setUseFixtures(e.target.checked)} /> Use fixtures
      </label>
      {error && <p className="rounded-lg bg-surface p-3 font-mono text-sm text-error">{error}</p>}

      {useFixtures ? (
        <section className="space-y-3 rounded-xl bg-surface p-4">
          <p className="text-sm text-secondary">{fixtureQuest.title} / {firstPrediction.id}</p>
          <p className="text-lg">{firstPrediction.prompt}</p>
          {firstPrediction.options.map((o) => (
            <button key={o.id} className="block w-full rounded-lg bg-surface-high p-3 text-left hover:bg-surface-highest">{o.text}</button>
          ))}
        </section>
      ) : !authed ? (
        <form onSubmit={(e) => auth(e, 'login')} className="space-y-3 rounded-xl bg-surface p-4">
          <input className={input} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email" />
          <input className={input} type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="password" />
          <button className={btn} type="submit">Log in</button>
          <button type="button" className="ml-3 text-secondary underline" onClick={(e) => auth(e, 'register')}>or register</button>
        </form>
      ) : (
        <section className="space-y-3">
          <div className="flex gap-3">
            <button className={btn} onClick={loadServers}>Load my servers</button>
            <button className="text-ink-muted underline" onClick={() => (setToken(null), setAuthed(false), setServers([]), setDetail(null))}>Log out</button>
          </div>
          <ul className="space-y-1">
            {servers.map((s) => (
              <li key={s.id}>
                <button className="text-secondary hover:text-secondary-deep" onClick={() => run(api.getServer(s.id).then(setDetail))}>
                  {s.name} <span className="text-ink-muted">({s.status}, {s.world_count} worlds)</span>
                </button>
              </li>
            ))}
          </ul>
          {detail && <pre className="overflow-x-auto rounded-xl bg-surface p-4 font-mono text-xs">{JSON.stringify(detail, null, 2)}</pre>}
        </section>
      )}
    </main>
  )
}
