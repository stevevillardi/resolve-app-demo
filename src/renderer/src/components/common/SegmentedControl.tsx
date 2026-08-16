import { useId } from 'react'
import { cn } from '@/lib/utils'

interface SegmentedControlOption<T extends string> {
  value: T
  label: string
}

interface SegmentedControlProps<T extends string> {
  options: SegmentedControlOption<T>[]
  value: T
  onChange: (value: T) => void
  'aria-label'?: string
  className?: string
}

/**
 * A radiogroup, not a tablist — these pick a *value* for a field (backend,
 * sandbox, scope), they don't switch panels. Arrow keys move between options
 * natively because each segment is a real radio input under the label.
 *
 * The thumb is one absolutely-positioned element that translates, so the
 * selection slides instead of blinking between two backgrounds.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  'aria-label': ariaLabel,
  className
}: SegmentedControlProps<T>): React.JSX.Element {
  const groupName = useId()
  const activeIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value)
  )

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn('bg-muted relative flex rounded-lg p-0.5', className)}
    >
      <span
        aria-hidden
        className="bg-background ring-border/60 pointer-events-none absolute inset-y-0.5 left-0.5 rounded-md ring-1 transition-transform duration-150 ease-out"
        style={{
          width: `calc((100% - 0.25rem) / ${options.length})`,
          transform: `translateX(${activeIndex * 100}%)`
        }}
      />
      {options.map((option) => {
        const selected = option.value === value
        return (
          <label
            key={option.value}
            className={cn(
              'relative z-10 flex-1 cursor-pointer rounded-md px-2.5 py-1 text-center text-xs font-medium whitespace-nowrap transition-colors',
              'focus-within:ring-ring/50 focus-within:ring-2',
              selected ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <input
              type="radio"
              name={groupName}
              value={option.value}
              checked={selected}
              onChange={() => onChange(option.value)}
              className="sr-only"
            />
            {option.label}
          </label>
        )
      })}
    </div>
  )
}
