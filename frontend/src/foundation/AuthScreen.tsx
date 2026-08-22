import { useState, type FormEvent } from 'react'
import { api } from '../api/client'
import type { TokenOut } from '../api/types'
import { readableError } from './errors'
import { Brand } from './Brand'

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
    <main className="min-h-screen bg-app-grid px-4 py-6 sm:grid sm:place-items-center sm:py-12">
      <div className="cq-panel grid w-full max-w-6xl overflow-hidden lg:grid-cols-[1.05fr_0.95fr]">
        <section className="relative hidden min-h-[42rem] overflow-hidden bg-world-night p-12 lg:flex lg:flex-col lg:justify-between">
          <div className="absolute inset-x-0 bottom-0 h-56 bg-gradient-to-t from-world/10 to-transparent" aria-hidden="true" />
          <div className="flex justify-center"><Brand /></div>
          <div className="relative max-w-md mt-8">
            <p className="eyebrow !text-lg">Your learning world</p>
            <h1 className="mt-5 text-[2.65rem] font-extrabold leading-[1.12] tracking-tight">Turn lecture notes into a world you can walk.</h1>
            <p className="mt-5 text-base leading-8 text-ink-muted">Upload slides or transcripts. ClassQuest maps the concepts and builds a quest around them—misconceptions included.</p>
            <div className="mt-8 flex items-center gap-5" aria-hidden="true">
              <img className="pixel-art h-16 w-16 object-contain" src="/brand/sprites/mentor-owl.png" alt="" />
              <div><p className="font-hud text-xs tracking-[0.12em] text-secondary">SOURCE-BOUND QUESTS</p><p className="mt-2 text-sm text-ink-muted">Predict. Investigate. Transfer.</p></div>
            </div>
          </div>
          <p className="relative text-xs text-ink-muted">classquest.net · Secure email and password access</p>
        </section>

        <section className="bg-surface p-6 sm:p-10 lg:flex lg:flex-col lg:justify-center lg:p-14">
          <div className="lg:hidden flex justify-center"><Brand /></div>
          <div className="mt-10 lg:mt-0">
            <p className="eyebrow !text-lg">{mode === 'login' ? 'Welcome back' : 'Create your account'}</p>
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
              {busy ? 'Opening portal…' : mode === 'login' ? 'Enter the world →' : 'Create account →'}
            </button>
          </form>

          <div className="my-6 flex items-center gap-4" aria-hidden="true"><span className="h-px flex-1 bg-white/10" /><span className="font-hud text-xs text-ink-muted">OR</span><span className="h-px flex-1 bg-white/10" /></div>
          <a className="button-secondary w-full" href="/demo">Walk the demo world</a>

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

function Field({ label, name, type = 'text', value, onChange, ...props }: { label: string; name: string; type?: string; value: string; onChange: (value: string) => void; autoComplete?: string; minLength?: number; required?: boolean }) {
  return (
    <label className="block" htmlFor={name}>
      <span className="mb-2 block text-sm font-bold text-ink">{label}</span>
      <input id={name} name={name} type={type} value={value} onChange={(event) => onChange(event.target.value)} className="field" {...props} />
    </label>
  )
}
