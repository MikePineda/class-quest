/**
 * The signed-in front door: pick what to do next.
 *
 * Laid out from a mockup, but only the parts of it the API can back. Three
 * things in that design have no data behind them and are therefore not here:
 *
 * - **"last opened today"** on a server row. `ServerSummary` carries no
 *   last-opened timestamp; `created_at` is when the server was made.
 * - **a hub-level "68% concept recovery" bar.** `GET /servers` returns
 *   summaries only — completion (`my_completion`) is per world, on
 *   `ServerDetail`. The honest signal that *is* on the wire is `my_xp` per
 *   server, so it rides on the row it belongs to instead of being summed into
 *   a headline percentage with no denominator.
 * - **"LATER EXTENSION" cards** for analytics and avatars. Nothing is built
 *   behind them, and a demo stand cannot tell an unbuilt feature from a broken
 *   one.
 *
 * Every control on this screen goes somewhere real: `/demo` is the bundled
 * encounter, the two forms are the live create/join endpoints, and each server
 * row is `/servers/{id}`.
 */
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { api } from '../api/client'
import type { ServerSummary, User } from '../api/types'
import { readableError } from './errors'
import { Brand } from './Brand'
import { CohortStatusCard } from './CohortStatusCard'
import { serverMeta } from './serverMeta'
import { statusTone } from './status'

type Tab = 'create' | 'join'

interface ServerHubProps {
  user: User
  onSignOut: () => void
}

export function ServerHub({ user, onSignOut }: ServerHubProps) {
  const [servers, setServers] = useState<ServerSummary[]>([])
  const [tab, setTab] = useState<Tab>('create')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // The action cards and the empty state all point at the same panel. Focusing
  // it scrolls it into view *and* lands the keyboard there, which a plain
  // `#anchor` does for neither.
  const panelRef = useRef<HTMLDivElement>(null)

  const openPanel = useCallback((next: Tab) => {
    setTab(next)
    panelRef.current?.focus()
  }, [])

  const loadServers = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setServers((await api.listServers()).servers)
    } catch (caught) {
      setError(readableError(caught))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let active = true
    api
      .listServers()
      .then((result) => {
        if (active) setServers(result.servers)
      })
      .catch((caught: unknown) => {
        if (active) setError(readableError(caught))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  return (
    <div className="min-h-screen bg-app-grid">
      <header className="border-b border-white/10 bg-background-raised/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-4 sm:px-6 lg:px-8">
          <Brand compact subtitle="Server hub" />
          <div className="flex items-center gap-2 sm:gap-3">
            <span className="hidden text-sm text-ink-muted md:inline">
              Welcome back, <strong className="font-semibold text-ink">{user.display_name}</strong>
            </span>
            <a
              className="rounded-lg px-3 py-2 text-sm font-bold text-ink-muted transition hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              href="/profile"
            >
              Profile
            </a>
            <button
              type="button"
              className="rounded-lg border border-white/10 px-3 py-2 text-sm font-bold text-ink-muted transition hover:border-white/25 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              onClick={onSignOut}
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 lg:py-12">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <p className="eyebrow">Your learning hub</p>
            <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">Choose what to do next.</h1>
            <p className="mt-3 max-w-2xl text-ink-muted">
              No mode lock-in. Start a challenge, create a world, join a server, or return to work already in
              progress.
            </p>
          </div>
          <button className="button-secondary shrink-0" type="button" onClick={() => void loadServers()} disabled={loading}>
            {loading ? 'Refreshing…' : 'Refresh servers'}
          </button>
        </div>

        {error && (
          <div className="mt-6 rounded-xl border border-error/25 bg-error/8 p-4 text-sm text-error" role="alert">
            {error}
          </div>
        )}

        <section className="mt-8" aria-labelledby="hub-actions-title">
          <h2 id="hub-actions-title" className="sr-only">
            What you can do
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <HubAction
              glyph="✦"
              href="/demo"
              title="Start a challenge"
              description="One focused encounter from a built-in world. No server needed."
              primary
            />
            <HubAction
              glyph="+"
              title="Create a server"
              description="Use notes, lectures, or files."
              onClick={() => openPanel('create')}
            />
            <HubAction
              glyph="↗"
              title="Join a server"
              description="Enter a code and learn together."
              onClick={() => openPanel('join')}
            />
            <HubAction
              glyph="▣"
              href="#my-servers"
              title="My servers"
              description="Open any world you already joined."
            />
          </div>
        </section>

        <div className="mt-6 grid items-start gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(22rem,0.85fr)]">
          <section id="my-servers" className="cq-panel scroll-mt-6 p-5 sm:p-7" aria-labelledby="my-servers-title">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="eyebrow">My learning worlds</p>
                <h2 id="my-servers-title" className="mt-1 text-xl font-black">
                  Every server stays open to you
                </h2>
                <p className="mt-2 text-sm leading-6 text-ink-muted">
                  However you use a server, it stays available here.
                </p>
              </div>
              <span className="shrink-0 rounded-full bg-surface-high px-3 py-1 text-sm font-bold text-ink-muted">
                {servers.length}
              </span>
            </div>

            <div className="mt-6">
              {loading && servers.length === 0 ? (
                <p className="text-sm text-ink-muted" role="status">
                  Loading your servers…
                </p>
              ) : servers.length === 0 ? (
                <EmptyServers onCreate={() => openPanel('create')} onJoin={() => openPanel('join')} />
              ) : (
                <ul className="space-y-3">
                  {servers.map((server) => (
                    <li key={server.id}>
                      <ServerCard server={server} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          <section className="cq-panel p-5 sm:p-7" aria-labelledby="hub-add-title">
            <p className="eyebrow">Add a server</p>
            <h2 id="hub-add-title" className="mt-1 text-xl font-black">
              Bring in new material, or a code
            </h2>
            <div className="mt-5 flex rounded-xl bg-background/45 p-1" role="tablist" aria-label="Add a server">
              <TabButton tab="create" active={tab === 'create'} onSelect={setTab}>
                Create a server
              </TabButton>
              <TabButton tab="join" active={tab === 'join'} onSelect={setTab}>
                Join with code
              </TabButton>
            </div>
            <div
              ref={panelRef}
              tabIndex={-1}
              role="tabpanel"
              id={`hub-panel-${tab}`}
              aria-labelledby={`hub-tab-${tab}`}
              className="mt-7 scroll-mt-6 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary focus-visible:ring-offset-4 focus-visible:ring-offset-surface"
            >
              {tab === 'create' ? (
                <CreateServerForm
                  onCreated={(server) => {
                    setServers((items) => [server, ...items])
                    setError(null)
                  }}
                />
              ) : (
                <JoinServerForm
                  onJoined={(server) => {
                    setServers((items) => [server, ...items.filter((item) => item.id !== server.id)])
                    setError(null)
                  }}
                />
              )}
            </div>
          </section>
        </div>
      </main>
    </div>
  )
}

function TabButton({
  tab,
  active,
  onSelect,
  children,
}: {
  tab: Tab
  active: boolean
  onSelect: (tab: Tab) => void
  children: string
}) {
  return (
    <button
      type="button"
      role="tab"
      id={`hub-tab-${tab}`}
      aria-selected={active}
      aria-controls={active ? `hub-panel-${tab}` : undefined}
      onClick={() => onSelect(tab)}
      className={`flex-1 rounded-lg px-3 py-3 text-sm font-extrabold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary sm:px-4 ${
        active ? 'bg-surface-highest text-ink shadow' : 'text-ink-muted hover:text-ink'
      }`}
    >
      {children}
    </button>
  )
}

/**
 * One of the four things the hub offers. A link when the destination is an
 * address, a button when it moves focus on this page — never a div pretending
 * to be either.
 */
function HubAction({
  glyph,
  title,
  description,
  href,
  onClick,
  primary = false,
}: {
  glyph: string
  title: string
  description: string
  href?: string
  onClick?: () => void
  primary?: boolean
}) {
  // `justify-start`, not `between`: the grid already makes every card the
  // height of the tallest one, so spreading the two lines apart opened a gap
  // under three of the four titles.
  const className = `group flex min-h-28 flex-col justify-start rounded-xl border p-4 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
    primary
      ? 'border-primary bg-primary text-[#1a1204] shadow-lg shadow-primary/10 hover:bg-primary-soft'
      : 'border-white/10 bg-surface-high hover:border-secondary/50 hover:bg-surface-highest'
  }`
  const content = (
    <>
      <span className={`flex items-center gap-2 text-base font-black ${primary ? 'text-[#1a1204]' : 'text-ink'}`}>
        <span aria-hidden="true" className={primary ? 'text-[#3b2b0f]' : 'text-secondary'}>
          {glyph}
        </span>
        {title}
      </span>
      <span className={`mt-3 text-xs leading-5 ${primary ? 'text-[#3b2b0f]' : 'text-ink-muted'}`}>{description}</span>
    </>
  )
  return href ? (
    <a className={className} href={href}>
      {content}
    </a>
  ) : (
    <button className={className} type="button" onClick={onClick}>
      {content}
    </button>
  )
}

function CreateServerForm({ onCreated }: { onCreated: (server: ServerSummary) => void }) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [pet, setPet] = useState('owl')
  const [isPublic, setIsPublic] = useState(false)
  const [text, setText] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<ServerSummary | null>(null)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (files.length === 0 && text.trim().length < 400) {
      setError('Paste at least 400 characters of notes, or attach a supported file.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const form = new FormData()
      form.append('name', name)
      if (description.trim()) form.append('description', description.trim())
      form.append('is_public', String(isPublic))
      form.append('pet', pet.trim())
      if (text.trim()) form.append('text', text.trim())
      files.forEach((file) => form.append('files', file))
      const server = await api.createServer(form)
      setCreated(server)
      onCreated(server)
    } catch (caught) {
      setError(readableError(caught))
    } finally {
      setBusy(false)
    }
  }

  if (created) {
    return (
      <div className="rounded-xl border border-secondary/30 bg-secondary/8 p-5" role="status">
        <p className="font-hud text-[10px] tracking-[0.12em] text-secondary">SERVER CREATION STARTED</p>
        <h3 className="mt-2 text-xl font-black">{created.name}</h3>
        <p className="mt-2 text-sm leading-6 text-ink-muted">
          ClassQuest is turning the material into learning worlds. Use the join code to invite teammates.
        </p>
        <div className="mt-4 flex items-center justify-between gap-3 rounded-lg bg-background/55 px-4 py-3">
          <span className="text-sm text-ink-muted">Join code</span>
          <strong className="font-hud text-base tracking-[0.14em] text-primary">{created.join_code ?? 'Pending'}</strong>
        </div>
        <button
          type="button"
          className="button-secondary mt-5"
          onClick={() => {
            setCreated(null)
            setName('')
            setDescription('')
            setText('')
            setFiles([])
          }}
        >
          Create another
        </button>
      </div>
    )
  }

  return (
    <form className="space-y-5" onSubmit={submit}>
      <div>
        <h3 className="text-lg font-black">Create from your material</h3>
        <p className="mt-1 text-sm text-ink-muted">Notes, transcripts, PDF, DOCX, PPTX, Markdown, or text.</p>
      </div>
      {error && (
        <div className="rounded-xl border border-error/25 bg-error/8 p-4 text-sm text-error" role="alert">
          {error}
        </div>
      )}
      <label className="block">
        <span className="field-label">Server name</span>
        <input
          className="field"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="e.g. Data Structures — Week 2"
          required
        />
      </label>
      <label className="block">
        <span className="field-label">
          Description <span className="font-normal text-ink-muted">(optional)</span>
        </span>
        <input
          className="field"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="What will the group learn?"
        />
      </label>
      <label className="block">
        <span className="field-label">Guide character</span>
        <select className="field" value={pet} onChange={(event) => setPet(event.target.value)}>
          <option value="owl">Owl</option>
          <option value="fox">Fox</option>
          <option value="dragon">Dragon</option>
          <option value="robot">Robot</option>
        </select>
      </label>
      <label className="block">
        <span className="field-label">Paste notes or transcript</span>
        <textarea
          className="field min-h-36 resize-y"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Paste at least 400 characters, or attach a file below."
        />
      </label>
      <label className="block rounded-xl border border-dashed border-white/20 bg-background/35 p-5 text-center transition hover:border-secondary/50">
        <img
          className="pixel-art mx-auto mb-3 h-10 w-10 object-contain"
          src="/brand/sprites/crystal-cluster.png"
          alt=""
          aria-hidden="true"
        />
        <span className="block font-bold">Attach lecture files</span>
        <span className="mt-1 block text-xs text-ink-muted">Up to 10 files, 10 MB each</span>
        <input
          className="mt-3 block w-full text-sm text-ink-muted file:mr-3 file:rounded-lg file:border-0 file:bg-surface-highest file:px-3 file:py-2 file:font-bold file:text-ink"
          type="file"
          accept=".txt,.md,.pdf,.docx,.pptx"
          multiple
          onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
        />
      </label>
      <label className="flex items-start gap-3 rounded-xl border border-white/10 bg-surface-high p-4">
        <input
          className="mt-1 h-4 w-4 accent-secondary"
          type="checkbox"
          checked={isPublic}
          onChange={(event) => setIsPublic(event.target.checked)}
        />
        <span>
          <span className="block font-bold">Public server</span>
          <span className="mt-0.5 block text-sm text-ink-muted">
            Allow the finished server to appear in public discovery later.
          </span>
        </span>
      </label>
      <button className="button-primary w-full sm:w-auto" type="submit" disabled={busy}>
        {busy ? 'Creating server…' : 'Create server'}
      </button>
    </form>
  )
}

function JoinServerForm({ onJoined }: { onJoined: (server: ServerSummary) => void }) {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const result = await api.joinServer(code)
      onJoined(result.server)
      setMessage(
        result.already_member
          ? `You are already a member of ${result.server.name}.`
          : `Joined ${result.server.name}.`,
      )
      setCode('')
    } catch (caught) {
      setError(readableError(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="space-y-5" onSubmit={submit}>
      <div>
        <h3 className="text-lg font-black">Join your team</h3>
        <p className="mt-1 text-sm text-ink-muted">Ask the server owner for the invite code.</p>
      </div>
      {error && (
        <div className="rounded-xl border border-error/25 bg-error/8 p-4 text-sm text-error" role="alert">
          {error}
        </div>
      )}
      {message && (
        <div className="rounded-xl border border-secondary/25 bg-secondary/8 p-4 text-sm text-secondary" role="status">
          {message}
        </div>
      )}
      <label className="block">
        <span className="field-label">Join code</span>
        <input
          className="field font-hud uppercase tracking-[0.16em]"
          value={code}
          onChange={(event) => setCode(event.target.value.toUpperCase())}
          placeholder="ABC123"
          maxLength={32}
          required
          autoComplete="off"
        />
      </label>
      <button className="button-primary" type="submit" disabled={busy || !code.trim()}>
        {busy ? 'Joining…' : 'Join server'}
      </button>
    </form>
  )
}

/**
 * One row: what the server is, how far its generation got, and — only when the
 * learner has actually earned some — the XP `GET /servers` reports for it.
 * There is no per-server completion on this endpoint, so no bar is drawn.
 */
function ServerCard({ server }: { server: ServerSummary }) {
  const meta = serverMeta(server)
  return (
    <a
      className="block rounded-xl border border-white/10 bg-surface-high/70 p-4 transition hover:border-secondary/40 hover:bg-surface-highest/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      href={`/servers/${server.id}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-bold text-ink">{server.name}</h3>
          {server.description && <p className="mt-1 line-clamp-2 text-sm text-ink-muted">{server.description}</p>}
        </div>
        <span
          className={`shrink-0 text-xs font-extrabold uppercase tracking-[0.12em] ${statusTone[server.status]}`}
        >
          {server.status}
        </span>
      </div>

      <p className="mt-2 text-xs text-ink-muted">
        {meta.map((segment, index) => (
          <span key={segment}>
            {index > 0 && <span aria-hidden="true"> · </span>}
            {segment}
          </span>
        ))}
        {server.my_xp > 0 && (
          <>
            <span aria-hidden="true"> · </span>
            <span className="font-bold text-primary">{server.my_xp} XP</span>
          </>
        )}
      </p>

      {server.join_code && (
        <p className="mt-3 text-xs text-ink-muted">
          Code <strong className="font-hud text-[10px] tracking-[0.08em] text-ink">{server.join_code}</strong>
        </p>
      )}

      {server.error && <p className="mt-3 text-xs text-error">{server.error}</p>}
      {server.status === 'ready' && <CohortStatusCard serverId={server.id} />}
    </a>
  )
}

function EmptyServers({ onCreate, onJoin }: { onCreate: () => void; onJoin: () => void }) {
  return (
    <div className="rounded-xl border border-dashed border-white/15 p-6 text-center">
      <p className="font-bold">No servers yet</p>
      <p className="mt-2 text-sm leading-6 text-ink-muted">
        Create one from your material, or join a teammate’s server with their code.
      </p>
      <div className="mt-5 flex flex-wrap justify-center gap-3">
        <button type="button" className="button-primary" onClick={onCreate}>
          Create a server
        </button>
        <button type="button" className="button-secondary" onClick={onJoin}>
          Join with code
        </button>
      </div>
    </div>
  )
}
