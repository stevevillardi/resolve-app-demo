import type { LucideIcon } from 'lucide-react'
import { EmptyState } from './EmptyState'

interface EmptyPaneProps {
  icon?: LucideIcon
  title: string
  description?: string
  action?: React.ReactNode
}

/**
 * A detail pane with nothing selected in it.
 *
 * Five views had written this same wrapper — background plane, a 48px strip
 * standing in for the `PaneHeader` that isn't there, and a centred
 * `EmptyState`. Worth one component for two reasons beyond the duplication.
 *
 * The strip is not decoration. With `titleBarStyle: 'hiddenInset'` the app has
 * to nominate its own draggable chrome, and a pane that omits it leaves the top
 * 48px of the window undraggable — so which section you happened to be on
 * decided whether you could move the window by its top edge.
 *
 * And it carries the border every `PaneHeader` draws. Without it the hairline
 * that runs unbroken across the window stopped dead at the pane divider on
 * exactly the screen you see most: selection is not persisted, so this is what
 * every launch opens on.
 */
export function EmptyPane({ icon, title, description, action }: EmptyPaneProps): React.JSX.Element {
  return (
    <div className="bg-background flex h-full flex-col">
      <div className="border-border drag-region h-12 shrink-0 border-b" />
      <EmptyState
        icon={icon}
        title={title}
        {...(description ? { description } : {})}
        {...(action ? { action } : {})}
      />
    </div>
  )
}
