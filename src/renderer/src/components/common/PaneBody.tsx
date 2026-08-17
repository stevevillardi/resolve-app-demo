import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'

interface PaneBodyProps {
  /**
   * `form` is fields and rows — it packs into columns as the pane widens (see
   * `FieldGrid`). `wide` is content that is already its own grid, like the
   * usage dashboard's charts, and only needs the room.
   *
   * Both are capped, and the cap is generous rather than tight: the measure
   * that keeps a form readable is the width of a *field*, which `FieldGrid`
   * owns, not the width of the pane.
   */
  measure?: 'form' | 'wide'
  children: React.ReactNode
  className?: string
}

/**
 * The scrolling body of a detail pane.
 *
 * Two decisions here, both of which used to be the other way round.
 *
 * **It does not centre.** `mx-auto` put the content in the middle of the pane
 * while `PaneHeader` stayed full-bleed, so the title sat hard left and the form
 * floated in the middle of the window with no edge shared between them. Left
 * aligned, the two line up and the pane reads as one column of content.
 *
 * **It is a container.** Everything responsive in here queries `@container/pane`
 * rather than the viewport. That distinction is the whole point: this pane is a
 * resizable panel the user can drag between 420px and the full window, while
 * the *window* is never narrower than 940px. Viewport breakpoints therefore
 * could not see the thing that actually varies — the four `sm:` variants this
 * replaced were permanently on, and their `grid-cols-1` fallback had never once
 * rendered.
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
          '@container/pane flex flex-col gap-6 p-5',
          measure === 'form' ? 'max-w-6xl' : 'max-w-7xl',
          className
        )}
      >
        {children}
      </div>
    </ScrollArea>
  )
}
