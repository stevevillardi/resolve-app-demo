import { cn } from '@/lib/utils'

interface ListRowProps {
  active: boolean
  onSelect: () => void
  /** Avatar, swatch or icon cluster on the left. */
  leading?: React.ReactNode
  /** Right-aligned and vertically centred — a cost figure, a check mark. */
  trailing?: React.ReactNode
  /**
   * `start` (the default) for rows carrying two or three stacked lines: centring
   * those makes the avatar drift down the row as the content grows. `center` for
   * single-line rows, where starting them aligns to nothing.
   */
  align?: 'start' | 'center'
  /**
   * Draws a border instead of relying on the panel around it. For rows that are
   * a choice inside a pane or a dialog rather than a list-panel row — there is
   * no enclosing list to imply they belong together.
   */
  bordered?: boolean
  children: React.ReactNode
  className?: string
}

/**
 * One selectable row.
 *
 * Every list in the app is master-detail over the same interaction — click to
 * select, one active row at a time — but only two of six used this. The other
 * four, plus the new-contact dialog and the branch pane's merge targets, each
 * re-declared a class string that was byte-identical apart from `items-start`
 * versus `items-center` and `px-2` versus `px-2.5`. So the lists felt subtly
 * unlike each other as you moved between sections, for no decided reason.
 *
 * The three props below exist to absorb those six, and are the whole variation
 * between them. A seventh caller wanting an eighth prop is a caller that is not
 * a list row.
 */
export function ListRow({
  active,
  onSelect,
  leading,
  trailing,
  align = 'start',
  bordered = false,
  children,
  className
}: ListRowProps): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onSelect}
      data-active={active}
      // Not for styling — it is how the screenshot sweep selects a row in any
      // section without knowing what that section's rows say, and how
      // "every list comes from ListRow" is checked mechanically rather than by
      // reading six files and hoping.
      data-testid="list-row"
      className={cn(
        'group flex w-full gap-2.5 rounded-lg text-left transition-colors',
        'focus-visible:ring-ring/50 outline-none focus-visible:ring-2',
        align === 'center' ? 'items-center' : 'items-start',
        bordered ? 'border-border border px-2.5 py-2' : 'px-2 py-2',
        active
          ? bordered
            ? 'border-primary bg-accent text-accent-foreground'
            : 'bg-accent text-accent-foreground'
          : 'hover:bg-accent/50',
        className
      )}
    >
      {leading}
      <span className="min-w-0 flex-1">{children}</span>
      {trailing}
    </button>
  )
}
