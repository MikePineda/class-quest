import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { api } from '../api/client'
import type { ServerSummary, User } from '../api/types'
import { readableError } from './errors'
import { Brand } from './Brand'

interface ServerHubProps {
  user: User
  onEditProfile: () => void
  onSignOut: () => void
}

export function ServerHub({ user, onEditProfile, onSignOut }: ServerHubProps) {
  const [servers, setServers] = useState<ServerSummary[]>([])
  const [tab, setTab] = useState<'create' | 'join'>('create')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

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
    api.listServers()
      .then((result) => {
        if (active) setServers(result.servers)
      })
      .catch((caught: unknown) => {
        if (active) setError(readableError(caught))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => { active = false }
  }, [])

  return (
    <div className="min-h-screen bg-app-grid">
      <header className="border-b border-white/10 bg-background-raised/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
          <Brand large subtitle="Server hub" subtitleClass="font-bold text-yellow-300" />
          <div className="flex items-center gap-3"><button type="button" className="hidden text-sm font-semibold text-ink-muted hover:text-ink sm:block" onClick={onEditProfile}>{user.display_name}</button><button type="button" className="rounded-lg border border-white/10 px-3 py-2 text-sm font-bold text-ink-muted hover:border-white/25 hover:text-ink" onClick={onSignOut}>Sign out</button></div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 pt-3 pb-8 sm:px-6 sm:pt-4 sm:pb-12 lg:px-8 lg:pt-6 lg:pb-12">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div><p className="eyebrow !text-base sm:!text-lg">Welcome, {user.display_name}</p><h1 className="mt-4 text-3xl font-black tracking-tight text-ink sm:text-4xl lg:text-5xl">Choose your next learning world.</h1><p className="mt-3 max-w-2xl text-base leading-7 text-ink-muted sm:text-lg">Create one from course material or join your team with a code.</p></div>
          <button className="button-secondary" type="button" onClick={() => void loadServers()} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh servers'}</button>
        </div>

        {error && <div className="mt-6 rounded-xl border border-error/25 bg-error/8 p-4 text-sm text-error" role="alert">{error}</div>}

        <div className="mt-8 grid items-start gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(22rem,0.85fr)]">
          <section className="cq-panel p-5 sm:p-7">
            <div className="flex rounded-xl bg-background/45 p-1" role="tablist" aria-label="Server actions">
              <TabButton active={tab === 'create'} onClick={() => setTab('create')}>Create a server</TabButton>
              <TabButton active={tab === 'join'} onClick={() => setTab('join')}>Join with code</TabButton>
            </div>
            <div className="mt-7">{tab === 'create' ? <CreateServerForm onCreated={(server) => { setServers((items) => [server, ...items]); setError(null) }} /> : <JoinServerForm onJoined={(server) => { setServers((items) => [server, ...items.filter((item) => item.id !== server.id)]); setError(null) }} />}</div>
          </section>

          <section className="cq-panel p-5 sm:p-7">
            <div className="flex items-center justify-between gap-4"><div><p className="eyebrow !text-base sm:!text-lg">My servers</p><h2 className="mt-2 text-xl font-black sm:text-2xl">Learning worlds</h2></div><span className="rounded-full bg-surface-high px-3 py-1 text-sm font-bold text-ink-muted">{servers.length}</span></div>
            <div className="mt-6 space-y-3">
              {loading && servers.length === 0 ? <p className="text-sm text-ink-muted">Loading your servers…</p> : servers.length === 0 ? <EmptyServers /> : servers.map((server) => <ServerCard key={server.id} server={server} />)}
            </div>
          </section>
        </div>
      </main>
    </div>
  )
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return <button type="button" role="tab" aria-selected={active} onClick={onClick} className={`flex-1 rounded-lg px-4 py-3 text-sm font-extrabold transition ${active ? 'bg-surface-highest text-ink shadow' : 'text-ink-muted hover:text-ink'}`}>{children}</button>
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
        <p className="mt-2 text-sm leading-6 text-ink-muted">ClassQuest is turning the material into learning worlds. Use the join code to invite teammates.</p>
        <div className="mt-4 flex items-center justify-between rounded-lg bg-background/55 px-4 py-3"><span className="text-sm text-ink-muted">Join code</span><strong className="font-hud text-base tracking-[0.14em] text-primary">{created.join_code ?? 'Pending'}</strong></div>
        <button type="button" className="button-secondary mt-5" onClick={() => { setCreated(null); setName(''); setDescription(''); setText(''); setFiles([]) }}>Create another</button>
      </div>
    )
  }

  return (
    <form className="space-y-5" onSubmit={submit}>
      <div><p className="text-xl font-black">Create from your material</p><p className="mt-1 text-sm text-ink-muted">Notes, transcripts, PDF, DOCX, PPTX, Markdown, or text.</p></div>
      {error && <div className="rounded-xl border border-error/25 bg-error/8 p-4 text-sm text-error" role="alert">{error}</div>}
      <label className="block"><span className="field-label">Server name</span><input className="field" value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Data Structures — Week 2" required /></label>
      <label className="block"><span className="field-label">Description <span className="font-normal text-ink-muted">(optional)</span></span><input className="field" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="What will the group learn?" /></label>
      <label className="block"><span className="field-label">Guide mascot</span><select className="field" value={pet} onChange={(event) => setPet(event.target.value)}><option value="owl">Owl</option><option value="fox">Fox</option><option value="dragon">Dragon</option><option value="robot">Robot</option></select></label>
      <label className="block"><span className="field-label">Paste notes or transcript</span><textarea className="field min-h-36 resize-y" value={text} onChange={(event) => setText(event.target.value)} placeholder="Paste at least 400 characters, or attach a file below." /></label>
      <label className="block rounded-xl border border-dashed border-white/20 bg-background/35 p-5 text-center transition hover:border-secondary/50"><img className="pixel-art mx-auto mb-3 h-10 w-10 object-contain" src="/brand/sprites/crystal-cluster.png" alt="" aria-hidden="true" /><span className="block font-bold">Attach lecture files</span><span className="mt-1 block text-xs text-ink-muted">Up to 10 files, 10 MB each</span><input className="mt-3 block w-full text-sm text-ink-muted file:mr-3 file:rounded-lg file:border-0 file:bg-surface-highest file:px-3 file:py-2 file:font-bold file:text-ink" type="file" accept=".txt,.md,.pdf,.docx,.pptx" multiple onChange={(event) => setFiles(Array.from(event.target.files ?? []))} /></label>
      <label className="flex items-start gap-3 rounded-xl border border-white/10 bg-surface-high p-4"><input className="mt-1 h-4 w-4 accent-secondary" type="checkbox" checked={isPublic} onChange={(event) => setIsPublic(event.target.checked)} /><span><span className="block font-bold">Public server</span><span className="mt-0.5 block text-sm text-ink-muted">Allow the finished server to appear in public discovery later.</span></span></label>
      <div className="flex justify-center"><button className="button-primary w-full sm:w-auto" type="submit" disabled={busy}>{busy ? 'Creating server…' : 'Create server'}</button></div>
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
      setMessage(result.already_member ? `You are already a member of ${result.server.name}.` : `Joined ${result.server.name}.`)
      setCode('')
    } catch (caught) {
      setError(readableError(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="space-y-5" onSubmit={submit}>
      <div><p className="text-xl font-black">Join your team</p><p className="mt-1 text-sm text-ink-muted">Ask the server owner for the invite code.</p></div>
      {error && <div className="rounded-xl border border-error/25 bg-error/8 p-4 text-sm text-error" role="alert">{error}</div>}
      {message && <div className="rounded-xl border border-secondary/25 bg-secondary/8 p-4 text-sm text-secondary" role="status">{message}</div>}
      <label className="block"><span className="field-label">Join code</span><input className="field font-hud uppercase tracking-[0.16em]" value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="ABC123" maxLength={32} required autoComplete="off" /></label>
      <button className="button-primary" type="submit" disabled={busy || !code.trim()}>{busy ? 'Joining…' : 'Join server'}</button>
    </form>
  )
}

function ServerCard({ server }: { server: ServerSummary }) {
  const statusColor = server.status === 'ready' ? 'text-secondary' : server.status === 'failed' ? 'text-error' : 'text-primary-soft'
  return (
    <a className="block rounded-lg border border-white/10 bg-surface-high/70 p-4 transition hover:border-white/20 hover:bg-surface-highest/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary focus-visible:ring-offset-2 focus-visible:ring-offset-background" href="/world">
      <div className="flex items-start justify-between gap-3"><div><h3 className="font-bold text-ink">{server.name}</h3><p className="mt-1 line-clamp-2 text-sm text-ink-muted">{server.description || `${server.pet} guide · ${server.member_count} member${server.member_count === 1 ? '' : 's'}`}</p></div><span className={`text-xs font-extrabold uppercase tracking-[0.12em] ${statusColor}`}>{server.status}</span></div>
      <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-ink-muted"><span>{server.world_count} world{server.world_count === 1 ? '' : 's'}</span>{server.join_code && <><span aria-hidden="true">·</span><span>Code <strong className="font-hud text-[10px] tracking-[0.08em] text-ink">{server.join_code}</strong></span></>}</div>
      {server.error && <p className="mt-3 text-xs text-error">{server.error}</p>}
    </a>
  )
}

function EmptyServers() {
  return <div className="rounded-xl border border-dashed border-white/15 p-6 text-center"><p className="font-bold">No servers yet</p><p className="mt-2 text-sm leading-6 text-ink-muted">Create one from your material or join a teammate’s server.</p></div>
}
