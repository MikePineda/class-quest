interface BrandProps {
  compact?: boolean
  large?: boolean
  subtitle?: string
  subtitleClass?: string
}

export function Brand({ compact = false, large = false, subtitle = 'Learn by playing', subtitleClass = 'text-ink-muted' }: BrandProps) {
  const logoClass = large
    ? 'h-20 w-auto sm:h-24'
    : compact
      ? 'h-11 w-auto'
      : 'h-32 w-auto sm:h-40'
  const wordmarkSize = large ? 'text-2xl' : 'text-xs'
  const subtitleSize = large ? 'text-base' : 'text-[11px]'

  return (
    <div className="brand-lockup flex items-center gap-4">
      <img
        className={logoClass}
        src="/brand/classquest-logo.png"
        alt="ClassQuest"
      />
      {(compact || large) && (
        <div className="hidden sm:block">
          <p className={`font-hud tracking-[0.08em] text-ink ${wordmarkSize}`}>ClassQuest</p>
          <p className={`mt-1 ${subtitleSize} ${subtitleClass}`}>{subtitle}</p>
        </div>
      )}
    </div>
  )
}
