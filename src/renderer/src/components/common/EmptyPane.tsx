import type { LucideIcon } from 'lucide-react'
import { EmptyState } from './EmptyState'
import { PANE_STRIP } from './PaneHeader'

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
 * The strip is `PANE_STRIP` rather than a local copy of it. It was a local copy,
 * and that is precisely how the title strip ended up two-tone on a fresh
 * install: `bg-card` was added to `PaneHeader` and this copy kept
 * `bg-background`, so the seam under the traffic lights reopened on the one
 * screen with no contacts to show — which every launch opens on, since selection
 * is not persisted.
 */
export function EmptyPane({ icon, title, description, action }: EmptyPaneProps): React.JSX.Element {
  return (
    <div className="bg-background flex h-full flex-col">
      <div className={PANE_STRIP} />
      <EmptyState
        icon={icon}
        title={title}
        {...(description ? { description } : {})}
        {...(action ? { action } : {})}
      />
    </div>
  )
}
