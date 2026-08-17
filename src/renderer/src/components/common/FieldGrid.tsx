import { cn } from '@/lib/utils'

interface FieldGridProps {
  /**
   * How many columns the grid is allowed to reach on a wide pane. It starts at
   * one and steps up; this is the ceiling, not the count.
   *
   * `2` for form fields, where a third column would make each one too narrow to
   * hold a select and its hint. `3` for compact repeated rows — a skill
   * checklist, a file list — where the item is short and the list is long.
   */
  columns?: 2 | 3
  children: React.ReactNode
  className?: string
}

/**
 * A group of fields or rows that packs into columns as the pane allows.
 *
 * Breakpoints are **container** queries against `@container/pane`, declared by
 * `PaneBody`. The app used `sm:grid-cols-2` in four places before this, which
 * measured the window — and since the window can never be narrower than 940px
 * while `sm` is 640px, those were permanently on. A pane dragged down to its
 * 420px minimum still got two columns, and a pane at 1200px still got only two.
 *
 * The thresholds are deliberately above the point where the columns *fit*.
 * A field is a label, a control and a line of hint text; two of them at 300px
 * each technically fit at `@lg`, but the hints then wrap to three lines and the
 * form reads as more cramped than the single column it replaced.
 */
export function FieldGrid({ columns = 2, children, className }: FieldGridProps): React.JSX.Element {
  return (
    <div
      className={cn(
        'grid gap-4',
        columns === 3 ? '@2xl/pane:grid-cols-2 @5xl/pane:grid-cols-3' : '@3xl/pane:grid-cols-2',
        className
      )}
    >
      {children}
    </div>
  )
}

/**
 * A child of `FieldGrid` that always takes the whole row.
 *
 * For the long-form controls — a system prompt, a routine's prompt. They are
 * the reason `PaneBody`'s cap alone is not enough: a textarea in a 1150px cell
 * is a 1150px line, which is worse than the narrow column this replaced. So it
 * spans, and caps itself at a measure that is actually readable.
 */
export function FieldGridSpan({
  children,
  className
}: {
  children: React.ReactNode
  className?: string
}): React.JSX.Element {
  return <div className={cn('col-span-full max-w-3xl', className)}>{children}</div>
}
