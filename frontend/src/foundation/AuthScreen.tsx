import { useState, type FormEvent } from 'react'
import { api } from '../api/client'
import type { TokenOut } from '../api/types'
import { readableError } from './errors'

interface AuthScreenProps {
  onAuthenticated: (session: TokenOut) => void
}

export function AuthScreen({ onAuthenticated }: AuthScreenProps) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const session = mode === 'login'
        ? await api.login({ email, password })
        : await api.register({ email, password, display_name: displayName })
      onAuthenticated(session)
    } catch (caught) {
      setError(readableError(caught))
    } finally {
      setBusy(false)
    }
  }

  const switchMode = () => {
    setMode((current) => current === 'login' ? 'register' : 'login')
    setError(null)
  }

  return (
    <main className="min-h-screen bg-app-grid px-4 py-8 sm:grid sm:place-items-center sm:py-12">
      <div className="grid w-full max-w-5xl overflow-hidden rounded-2xl border border-white/10 bg-surface shadow-2xl shadow-black/35 lg:grid-cols-[1.05fr_0.95fr]">
        <section className="relative hidden min-h-[38rem] overflow-hidden bg-background p-10 lg:flex lg:flex-col lg:justify-between">
          <div className="absolute -right-28 -top-28 h-80 w-80 rounded-full bg-secondary/15 blur-3xl" aria-hidden="true" />
          <div className="absolute -bottom-32 -left-24 h-80 w-80 rounded-full bg-primary/15 blur-3xl" aria-hidden="true" />
          <Brand />
          <div className="relative max-w-md">
            <p className="eyebrow">Your learning world</p>
            <h1 className="mt-4 text-5xl font-black leading-[1.05] tracking-tight">Turn course material into a quest you can explore.</h1>
            <p className="mt-5 text-lg leading-8 text-ink-muted">Create a private class world, invite a team, and learn from your own notes and lectures.</p>
          </div>
          <p className="relative text-sm text-ink-muted">classquest.net · Secure email and password access</p>
        </section>

        <section className="p-6 sm:p-10 lg:p-12">
          <div className="lg:hidden"><Brand /></div>
          <div className="mt-10 lg:mt-0">
            <p className="eyebrow">{mode === 'login' ? 'Welcome back' : 'Create your account'}</p>
            <h2 className="mt-2 text-3xl font-black tracking-tight">{mode === 'login' ? 'Sign in to ClassQuest' : 'Start your first quest'}</h2>
            <p className="mt-3 text-ink-muted">{mode === 'login' ? 'Continue to your servers and learning worlds.' : 'We will personalize the experience in the next step.'}</p>
          </div>

          {error && <div className="mt-6 rounded-xl border border-error/25 bg-error/8 p-4 text-sm text-error" role="alert">{error}</div>}

          <form className="mt-7 space-y-5" onSubmit={submit}>
            {mode === 'register' && (
              <Field label="Display name" name="display-name" value={displayName} onChange={setDisplayName} autoComplete="name" required />
            )}
            <Field label="Email address" name="email" type="email" value={email} onChange={setEmail} autoComplete="email" required />
            <Field label="Password" name="password" type="password" value={password} onChange={setPassword} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={8} required />

            <button className="button-primary w-full" type="submit" disabled={busy}>
              {busy ? 'Connecting…' : mode === 'login' ? 'Sign in' : 'Create account'}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-ink-muted">
            {mode === 'login' ? 'New to ClassQuest?' : 'Already have an account?'}{' '}
            <button className="font-bold text-secondary underline-offset-4 hover:underline" type="button" onClick={switchMode}>
              {mode === 'login' ? 'Create an account' : 'Sign in instead'}
            </button>
          </p>
        </section>
      </div>
    </main>
  )
}

function Brand() {
  return (
    <div className="relative flex items-center gap-3">
      <span className="grid h-11 w-11 place-items-center rounded-xl bg-primary font-black text-background" aria-hidden="true">CQ</span>
      <div><p className="text-lg font-black">ClassQuest</p><p className="text-xs text-ink-muted">Learn by playing</p></div>
    </div>
  )
}

function Field({ label, name, type = 'text', value, onChange, ...props }: { label: string; name: string; type?: string; value: string; onChange: (value: string) => void; autoComplete?: string; minLength?: number; required?: boolean }) {
  return (
    <label className="block" htmlFor={name}>
      <span className="mb-2 block text-sm font-bold text-ink">{label}</span>
      <input id={name} name={name} type={type} value={value} onChange={(event) => onChange(event.target.value)} className="field" {...props} />
    </label>
  )
}
