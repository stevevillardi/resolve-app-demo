import { cn } from '@/lib/utils'

interface ListRowProps {
  active: boolean
  onSelect: () => void
  /** Avatar, swatch or icon cluster on the left. */
  leading?: React.ReactNode
  children: React.ReactNode
  className?: string
}

/**
 * One selectable row in the middle list panel.
 *
 * All five section lists are master-detail over the same interaction — click to
 * select, one active row at a time — but each had written its own button with
 * slightly different padding, gap and focus ring, so the lists felt subtly
 * unlike each other as you moved between sections.
 *
 * `items-start` rather than `items-center`: rows carry two or three stacked
 * lines of varying height, and centring makes the avatar drift down the row as
 * the content grows.
 */
export function ListRow({
  active,
  onSelect,
  leading,
  children,
  className
}: ListRowProps): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onSelect}
      data-active={active}
      className={cn(
        'group flex w-full items-start gap-2.5 rounded-lg px-2 py-2 text-left transition-colors',
        'focus-visible:ring-ring/50 outline-none focus-visible:ring-2',
        active ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50',
        className
      )}
    >
      {leading}
      <span className="min-w-0 flex-1">{children}</span>
    </button>
  )
}
