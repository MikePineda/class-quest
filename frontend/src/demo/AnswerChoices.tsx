import type { Option } from '../api/types'

interface AnswerChoicesProps {
  options: Option[]
  selectedId: string | null
  locked: boolean
  label: string
  onSelect: (optionId: string) => void
}

export function AnswerChoices({ options, selectedId, locked, label, onSelect }: AnswerChoicesProps) {
  return (
    <div className="space-y-3" role="radiogroup" aria-label={label}>
      {options.map((option, index) => {
        const selected = option.id === selectedId
        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-disabled={locked}
            onClick={() => {
              if (!locked) onSelect(option.id)
            }}
            className={`answer-choice group w-full rounded-xl border px-4 py-4 text-left transition sm:px-5 ${
              selected
                ? 'border-secondary bg-secondary/10 text-ink shadow-[0_0_0_1px_rgba(79,219,200,0.2)]'
                : 'border-white/10 bg-surface-high/75 text-ink hover:border-white/25 hover:bg-surface-highest'
            } ${locked && !selected ? 'opacity-45' : ''}`}
          >
            <span className="flex items-center gap-4">
              <span
                aria-hidden="true"
                className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg border font-mono text-sm font-bold ${
                  selected
                    ? 'border-secondary bg-secondary text-background'
                    : 'border-white/15 bg-background/40 text-ink-muted group-hover:border-white/30'
                }`}
              >
                {String.fromCharCode(65 + index)}
              </span>
              <span className="font-medium leading-6">{option.text}</span>
              <span
                aria-hidden="true"
                className={`ml-auto h-3 w-3 shrink-0 rounded-full border ${
                  selected ? 'border-secondary bg-secondary shadow-[0_0_12px_rgba(79,219,200,0.85)]' : 'border-outline/60'
                }`}
              />
            </span>
          </button>
        )
      })}
    </div>
  )
}
