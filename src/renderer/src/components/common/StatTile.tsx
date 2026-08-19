import { cn } from '@/lib/utils'

/**
 * The small-caps caption above a value or a group of rows.
 *
 * A class constant rather than a component, the same shape as `PANE_STRIP`:
 * these labels sit on a `p` in one place and a `span` in another, and the
 * thing worth sharing is the type treatment, not the element. It had been
 * copy-pasted verbatim into nine files, and had already drifted in two of them
 * — `text-xs` in the starter library, `text-micro` in the run indicator.
 */
export const CAPTION = 'text-muted-foreground text-meta font-medium tracking-wide uppercase'

interface StatTileProps {
  label: string
  /** Pre-formatted. Tiles do not do arithmetic — `lib/usage` owns that. */
  value: string
  /** The caveat under the number, when the number has one. */
  note?: string
  /** A sparkline or meter under the value. Optional; most tiles are text. */
  children?: React.ReactNode
  className?: string
}

/**
 * One measured figure in a bordered tile.
 *
 * Mono and tabular because these sit in a row and are read down the column:
 * proportional digits make four tiles look like four different sizes of
 * number. Lifted out of the usage dashboard when the context sheet needed the
 * same treatment for its prompt-size figures — the second copy is where the
 * app's headings have historically started to drift apart.
 */
export function StatTile({
  label,
  value,
  note,
  children,
  className
}: StatTileProps): React.JSX.Element {
  return (
    <div className={cn('border-border rounded-lg border p-3', className)}>
      <p className={CAPTION}>{label}</p>
      <p className="mt-1 font-mono text-xl tabular-nums">{value}</p>
      {note && <p className="text-muted-foreground mt-0.5 text-meta">{note}</p>}
      {children}
    </div>
  )
}
