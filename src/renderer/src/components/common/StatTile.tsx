import { Info } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

/**
 * The small-caps caption above a value or a group of rows.
 *
 * A class constant rather than a component, the same shape as `PANE_STRIP`:
 * these labels sit on a `p` in one place and a `span` in another, and the
 * thing worth sharing is the type treatment, not the element. Nine files use
 * it; one constant is what keeps all nine identical, because a caption pasted
 * verbatim into the tenth is a caption that will end up at a different size.
 */
export const CAPTION = 'text-muted-foreground text-meta font-medium tracking-wide uppercase'

interface StatTileProps {
  label: string
  /** Pre-formatted. Tiles do not do arithmetic — `lib/usage` owns that. */
  value: string
  /** The caveat under the number, when the number has one. */
  note?: string
  /**
   * Something true about the figure that most readers do not need.
   *
   * Behind an icon rather than printed under the value: a caveat set in
   * permanent prose beside every number reads as a warning about the number,
   * and these are footnotes. The figure itself still carries its own signal —
   * a partial total ends in `+`, an unknown one is an em dash — so the tooltip
   * explains a mark that is already visible rather than being the only place
   * the truth appears.
   */
  hint?: string
  /** A sparkline or meter under the value. Optional; most tiles are text. */
  children?: React.ReactNode
  className?: string
}

/**
 * One measured figure in a bordered tile.
 *
 * Mono and tabular because these sit in a row and are read down the column:
 * proportional digits make four tiles look like four different sizes of
 * number. One component, shared by the usage dashboard and the context sheet's
 * prompt-size figures, so both stay identical.
 */
export function StatTile({
  label,
  value,
  note,
  hint,
  children,
  className
}: StatTileProps): React.JSX.Element {
  return (
    <div className={cn('border-border rounded-lg border p-3', className)}>
      <p className={cn(CAPTION, 'flex items-center gap-1')}>
        {label}
        {hint && (
          <Tooltip>
            <TooltipTrigger className="text-muted-foreground/70 hover:text-foreground rounded-sm">
              <Info className="size-3" />
              <span className="sr-only">About this figure</span>
            </TooltipTrigger>
            <TooltipContent>
              <p className="max-w-56 text-xs">{hint}</p>
            </TooltipContent>
          </Tooltip>
        )}
      </p>
      <p className="mt-1 font-mono text-xl tabular-nums">{value}</p>
      {note && <p className="text-muted-foreground mt-0.5 text-meta">{note}</p>}
      {children}
    </div>
  )
}
