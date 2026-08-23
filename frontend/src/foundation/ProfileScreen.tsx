import { useState, type FormEvent } from 'react'
import { api } from '../api/client'
import type { Role, User } from '../api/types'
import { readableError } from './errors'
import { Brand } from './Brand'
import { BackLink } from '../nav/BackLink'
import {
  loadLearningPreferences,
  saveLearningPreferences,
  type LearningGoal,
  type LearningMode,
  type SessionLength,
} from './learningPreferences'

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
  const [mode, setMode] = useState<LearningMode>(() => loadLearningPreferences(user.id).mode)
  const [goal, setGoal] = useState<LearningGoal>(() => loadLearningPreferences(user.id).goal)
  const [sessionLength, setSessionLength] = useState<SessionLength>(() => loadLearningPreferences(user.id).sessionLength)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const updated = await api.updateMe({ display_name: displayName, role, industry, about })
      saveLearningPreferences(user.id, { mode, goal, sessionLength })
      onSaved(updated)
    } catch (caught) {
      setError(readableError(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="min-h-screen bg-app-grid px-4 py-8 sm:grid sm:place-items-center">
      <section className="cq-panel w-full max-w-3xl overflow-hidden">
        <header className="flex items-center justify-between gap-3 border-b border-white/10 bg-background-raised/80 px-6 py-4 sm:px-10"><Brand compact subtitle="Hero setup" /><div className="flex items-center gap-2">{/* Saving and signing out were the only two ways off this screen. */}<BackLink to="/">Your servers</BackLink><button type="button" className="button-secondary min-h-9 px-3 py-1.5 text-xs" onClick={onSignOut}>Sign out</button></div></header>
        <div className="p-6 sm:p-10">
        <div className="flex items-start justify-between gap-4">
          <div><p className="eyebrow">Hero profile · one quick setup</p><h1 className="mt-3 text-3xl font-extrabold">Make ClassQuest fit you.</h1><p className="mt-3 max-w-xl leading-7 text-ink-muted">Choose your path so future questions and worlds can meet you at the right level.</p></div>
          <img className="pixel-art hidden h-20 w-20 object-contain sm:block" src="/brand/sprites/explorer.png" alt="" aria-hidden="true" />
        </div>

        {error && <div className="mt-6 rounded-xl border border-error/25 bg-error/8 p-4 text-sm text-error" role="alert">{error}</div>}

        <form className="mt-8 grid gap-6 sm:grid-cols-2" onSubmit={submit}>
          <label className="block sm:col-span-2"><span className="field-label">Display name</span><input className="field" value={displayName} onChange={(event) => setDisplayName(event.target.value)} required maxLength={80} /></label>
          <fieldset className="sm:col-span-2">
            <legend className="field-label">I am primarily a…</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              {(['student', 'teacher'] as Role[]).map((value) => (
                <label key={value} className={`cursor-pointer rounded-lg border p-4 transition ${role === value ? 'border-secondary bg-secondary/10 shadow-[0_0_0_1px_rgba(67,217,196,.18)]' : 'border-white/10 bg-surface-high hover:border-white/20'}`}>
                  <input className="sr-only" type="radio" name="role" value={value} checked={role === value} onChange={() => setRole(value)} />
                  <span className="font-bold capitalize">{value}</span><span className="mt-1 block text-sm text-ink-muted">{value === 'student' ? 'Join worlds and practise concepts.' : 'Create worlds from teaching material.'}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset className="sm:col-span-2">
            <legend className="field-label">How do you want to learn today?</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              {([
                ['solo', 'Solo practice', 'Private progress at your own pace.'],
                ['async_group', 'Group, own pace', 'Share a server without needing to be online together.'],
                ['live_group', 'Group, together', 'Join a live session when realtime play is available.'],
                ['undecided', 'I’m not sure yet', 'Start solo and choose a group later.'],
              ] as const).map(([value, label, description]) => (
                <ChoiceCard key={value} name="learning-mode" value={value} checked={mode === value} onChange={() => setMode(value)} label={label} description={description} />
              ))}
            </div>
          </fieldset>
          <label className="block"><span className="field-label">What is your main goal?</span><select className="field" value={goal} onChange={(event) => setGoal(event.target.value as LearningGoal)}><option value="understand">Understand a difficult concept</option><option value="assessment">Prepare for an assessment</option><option value="review">Review lecture material</option><option value="confidence">Build confidence</option></select></label>
          <label className="block"><span className="field-label">How much time do you have?</span><select className="field" value={sessionLength} onChange={(event) => setSessionLength(event.target.value as SessionLength)}><option value="quick">5–10 minutes</option><option value="focused">One focused session</option><option value="ongoing">Ongoing practice</option></select></label>
          <label className="block sm:col-span-2"><span className="field-label">Subject or industry</span><input className="field" value={industry} onChange={(event) => setIndustry(event.target.value)} placeholder="e.g. Computer science, finance, biology" maxLength={80} /></label>
          <label className="block sm:col-span-2"><span className="field-label">What are you hoping to learn or teach?</span><textarea className="field min-h-28 resize-y" value={about} onChange={(event) => setAbout(event.target.value)} placeholder="A short note is enough for now." maxLength={2000} /></label>
          <div className="sm:col-span-2"><p className="mb-3 text-xs text-ink-muted">Your learning preferences are saved on this device for now. You can change them from your profile.</p><button className="button-primary w-full sm:w-auto" type="submit" disabled={busy}>{busy ? 'Saving profile…' : 'Begin the journey →'}</button></div>
        </form>
        </div>
      </section>
    </main>
  )
}

function ChoiceCard({ name, value, checked, onChange, label, description }: { name: string; value: string; checked: boolean; onChange: () => void; label: string; description: string }) {
  return <label className={`cursor-pointer rounded-lg border p-4 transition ${checked ? 'border-secondary bg-secondary/10 shadow-[0_0_0_1px_rgba(67,217,196,.18)]' : 'border-white/10 bg-surface-high hover:border-white/20'}`}><input className="sr-only" type="radio" name={name} value={value} checked={checked} onChange={onChange} /><span className="font-bold text-ink">{label}</span><span className="mt-1 block text-sm text-ink-muted">{description}</span></label>
}
