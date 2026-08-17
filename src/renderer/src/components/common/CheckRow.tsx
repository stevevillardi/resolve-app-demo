import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'

interface CheckRowProps {
  checked: boolean
  onToggle: () => void
  title: string
  /** One line under the title. What picking this actually does. */
  description?: React.ReactNode
  /** An avatar or icon ahead of the checkbox — the catalog picker's bot faces. */
  leading?: React.ReactNode
  /**
   * Checked and not uncheckable, with the reason shown in place of the
   * description — a skill a chosen persona requires. Distinct from a plain
   * disabled row: the state is ON, and the user needs to know why.
   */
  lockedReason?: string
  className?: string
}

/**
 * A row you can turn on and off, as opposed to a row you select.
 *
 * `ListRow` deliberately does not cover this. Its whole contract is one active
 * row at a time — `active` drives the accent fill and the caller owns which
 * single id is current. A checklist is many-of-N, needs `role="checkbox"` and
 * `aria-checked` rather than a pressed button, and shows a box the user can
 * aim at. Forcing both into one component would mean a `multiple` flag that
 * changes the ARIA role, which is two components wearing one name.
 *
 * It exists because the persona editor's skill list was the fifth hand-rolled
 * row style in the app — after the four `ListRow` absorbed. Anything else that
 * wants a checklist uses this rather than growing a sixth.
 */
export function CheckRow({
  checked,
  onToggle,
  title,
  description,
  leading,
  lockedReason,
  className
}: CheckRowProps): React.JSX.Element {
  const locked = lockedReason !== undefined
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={locked ? true : checked}
      aria-disabled={locked || undefined}
      onClick={locked ? undefined : onToggle}
      data-testid="check-row"
      className={cn(
        'border-border flex items-start gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors',
        'focus-visible:ring-ring/50 outline-none focus-visible:ring-2',
        checked || locked ? 'bg-accent border-accent' : 'hover:bg-accent/40',
        locked && 'cursor-default opacity-80',
        className
      )}
    >
      <span
        className={cn(
          'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border',
          checked || locked ? 'bg-primary text-primary-foreground border-primary' : 'border-input'
        )}
      >
        {(checked || locked) && <Check className="size-3" />}
      </span>
      {leading}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-row font-medium">{title}</span>
        {locked ? (
          <span className="text-muted-foreground block text-xs">{lockedReason}</span>
        ) : (
          description && <span className="text-muted-foreground block text-xs">{description}</span>
        )}
      </span>
    </button>
  )
}
