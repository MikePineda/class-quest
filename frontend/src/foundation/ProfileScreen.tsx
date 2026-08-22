import { useState, type FormEvent } from 'react'
import { api } from '../api/client'
import type { Role, User } from '../api/types'
import { readableError } from './errors'

interface ProfileScreenProps {
  user: User
  onSaved: (user: User) => void
  onSignOut: () => void
}

export function ProfileScreen({ user, onSaved, onSignOut }: ProfileScreenProps) {
  const [displayName, setDisplayName] = useState(user.display_name)
  const [role, setRole] = useState<Role>(user.role ?? 'student')
  const [industry, setIndustry] = useState(user.industry ?? '')
  const [about, setAbout] = useState(user.about ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const updated = await api.updateMe({ display_name: displayName, role, industry, about })
      onSaved(updated)
    } catch (caught) {
      setError(readableError(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="min-h-screen bg-app-grid px-4 py-8 sm:grid sm:place-items-center">
      <section className="w-full max-w-3xl rounded-2xl border border-white/10 bg-surface p-6 shadow-2xl sm:p-10">
        <div className="flex items-start justify-between gap-4">
          <div><p className="eyebrow">One quick setup</p><h1 className="mt-2 text-3xl font-black">Make ClassQuest fit you.</h1><p className="mt-3 text-ink-muted">These basics will shape the personalized questions your team adds later.</p></div>
          <button type="button" className="text-sm font-semibold text-ink-muted hover:text-ink" onClick={onSignOut}>Sign out</button>
        </div>

        {error && <div className="mt-6 rounded-xl border border-error/25 bg-error/8 p-4 text-sm text-error" role="alert">{error}</div>}

        <form className="mt-8 grid gap-6 sm:grid-cols-2" onSubmit={submit}>
          <label className="block sm:col-span-2"><span className="field-label">Display name</span><input className="field" value={displayName} onChange={(event) => setDisplayName(event.target.value)} required maxLength={80} /></label>
          <fieldset className="sm:col-span-2">
            <legend className="field-label">I am primarily a…</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              {(['student', 'teacher'] as Role[]).map((value) => (
                <label key={value} className={`cursor-pointer rounded-xl border p-4 ${role === value ? 'border-secondary bg-secondary/10' : 'border-white/10 bg-surface-high'}`}>
                  <input className="sr-only" type="radio" name="role" value={value} checked={role === value} onChange={() => setRole(value)} />
                  <span className="font-bold capitalize">{value}</span><span className="mt-1 block text-sm text-ink-muted">{value === 'student' ? 'Join worlds and practise concepts.' : 'Create worlds from teaching material.'}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <label className="block sm:col-span-2"><span className="field-label">Subject or industry</span><input className="field" value={industry} onChange={(event) => setIndustry(event.target.value)} placeholder="e.g. Computer science, finance, biology" maxLength={80} /></label>
          <label className="block sm:col-span-2"><span className="field-label">What are you hoping to learn or teach?</span><textarea className="field min-h-28 resize-y" value={about} onChange={(event) => setAbout(event.target.value)} placeholder="A short note is enough for now." maxLength={2000} /></label>
          <div className="sm:col-span-2"><button className="button-primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save and continue'}</button></div>
        </form>
      </section>
    </main>
  )
}
