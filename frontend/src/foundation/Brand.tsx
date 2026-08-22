interface BrandProps {
  compact?: boolean
  subtitle?: string
}

export function Brand({ compact = false, subtitle = 'Learn by playing' }: BrandProps) {
  return (
    <div className="brand-lockup flex items-center gap-3">
      <img
        className={compact ? 'h-11 w-auto' : 'h-14 w-auto sm:h-16'}
        src="/brand/classquest-logo.png"
        alt="ClassQuest"
      />
      {compact && (
        <div className="hidden sm:block">
          <p className="font-hud text-xs tracking-[0.08em] text-ink">ClassQuest</p>
          <p className="mt-1 text-[11px] text-ink-muted">{subtitle}</p>
        </div>
      )}
    </div>
  )
}
