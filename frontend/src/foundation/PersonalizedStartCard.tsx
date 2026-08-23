import type { JSX } from 'react'

import type { Role } from '../api/types'
import type { LearningMode } from './learningPreferences'

interface PersonalizedStartCardProps {
  role: Role
  mode: LearningMode
  onCreateServer: () => void
  onJoinServer: () => void
}

export function PersonalizedStartCard({ role, mode, onCreateServer, onJoinServer }: PersonalizedStartCardProps): JSX.Element {
  if (role === 'teacher') {
    return <StartCard eyebrow="Recommended for you" title="Create a learning world" copy="Turn lecture notes or a transcript into a server your learners can explore." action="Create from material" onAction={onCreateServer} />
  }
  if (mode === 'solo') {
    return <StartCard eyebrow="Solo path" title="Start a private challenge" copy="Practise a concept on your own, then join a group whenever you are ready." action="Start solo practice" href="/demo" />
  }
  if (mode === 'async_group') {
    return <StartCard eyebrow="Group path" title="Join a server" copy="Answer at your own pace and compare shared learning patterns later." action="Join with a code" onAction={onJoinServer} />
  }
  if (mode === 'live_group') {
    return <StartCard eyebrow="Coming later" title="Live group sessions" copy="Realtime synchronized play is not available yet. You can start solo or join an async server today." action="Start solo practice" href="/demo" />
  }
  return <StartCard eyebrow="Flexible path" title="Choose your next step" copy="Start a solo challenge or join a server. Your preference can change later." action="Start solo practice" href="/demo" secondaryAction={{ label: 'Join a server', onClick: onJoinServer }} />
}

function StartCard({ eyebrow, title, copy, action, href, onAction, secondaryAction }: { eyebrow: string; title: string; copy: string; action: string; href?: string; onAction?: () => void; secondaryAction?: { label: string; onClick: () => void } }): JSX.Element {
  return (
    <section aria-label="Personalized starting path" className="mb-6 rounded-xl border border-secondary/30 bg-secondary/8 p-5 sm:p-6">
      <p className="eyebrow text-secondary">{eyebrow}</p>
      <div className="mt-2 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div><h2 className="text-xl font-black text-ink">{title}</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-ink-muted">{copy}</p></div>
        <div className="flex flex-wrap gap-2">
          {href ? <a className="button-primary whitespace-nowrap" href={href}>{action}</a> : <button className="button-primary whitespace-nowrap" type="button" onClick={onAction}>{action}</button>}
          {secondaryAction && <button className="button-secondary whitespace-nowrap" type="button" onClick={secondaryAction.onClick}>{secondaryAction.label}</button>}
        </div>
      </div>
    </section>
  )
}
