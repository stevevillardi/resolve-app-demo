import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'

interface PaneBodyProps {
  /**
   * `form` is a single column of fields — capped at a comfortable measure so
   * labels stay near their controls on a wide window. `wide` is for content
   * that genuinely uses the width, like a chart grid or a table.
   */
  measure?: 'form' | 'wide'
  children: React.ReactNode
  className?: string
}

/**
 * The scrolling body of a detail pane.
 *
 * The four workspace views each wrote this wrapper by hand and had drifted to
 * different numbers — two used `gap-5`, one `gap-6`, one a different max width
 * — so the vertical rhythm changed as you moved between sections. The measure
 * is a named choice here rather than a per-file guess.
 */
export function PaneBody({
  measure = 'form',
  children,
  className
}: PaneBodyProps): React.JSX.Element {
  return (
    <ScrollArea className="min-h-0 flex-1">
      <div
        className={cn(
          'mx-auto flex flex-col gap-6 p-5',
          measure === 'form' ? 'max-w-2xl' : 'max-w-4xl',
          className
        )}
      >
        {children}
      </div>
    </ScrollArea>
  )
}
