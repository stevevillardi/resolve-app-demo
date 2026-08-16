import { cn } from '@/lib/utils'

interface ThreadHeaderProps {
  leading: React.ReactNode
  title: string
  subtitle: string
  actions?: React.ReactNode
  className?: string
}

/**
 * Shared chrome for both thread views.
 *
 * Kept the same height as the list panel's header so the border under them is
 * one unbroken line across the window, and marked as a drag region — with
 * titleBarStyle: 'hiddenInset' the app has to provide its own draggable strip
 * or the window can't be moved.
 */
export function ThreadHeader({
  leading,
  title,
  subtitle,
  actions,
  className
}: ThreadHeaderProps): React.JSX.Element {
  return (
    <header
      className={cn(
        'border-border drag-region flex h-12 shrink-0 items-center gap-2.5 border-b px-4',
        className
      )}
    >
      {leading}
      <div className="flex min-w-0 flex-1 items-baseline gap-2">
        <h1 className="truncate text-sm font-semibold tracking-tight">{title}</h1>
        <span className="text-muted-foreground truncate font-mono text-[11px]">{subtitle}</span>
      </div>
      {actions && <div className="no-drag flex shrink-0 items-center gap-1.5">{actions}</div>}
    </header>
  )
}
