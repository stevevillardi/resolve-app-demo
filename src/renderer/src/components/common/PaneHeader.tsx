import { cn } from '@/lib/utils'

interface PaneHeaderProps {
  /** Avatar, swatch or icon identifying what the pane is showing. */
  leading?: React.ReactNode
  title: string
  /** Machine text — a repo path, a session id. Set in mono by the rule. */
  subtitle?: string
  actions?: React.ReactNode
  className?: string
}

/**
 * The top strip of every detail pane.
 *
 * Every workspace view had hand-rolled this same header, which is why they had
 * drifted apart — different gaps, different truncation, some with a subtitle
 * slot and some without. One component means the border beneath them stays a
 * single unbroken line across the window at every section.
 *
 * It is also the window's drag strip: with titleBarStyle 'hiddenInset' the app
 * must nominate its own draggable chrome, so this carries `drag-region` and the
 * actions cluster opts back out with `no-drag` — interactive children inside a
 * drag region stop receiving clicks entirely.
 */
export function PaneHeader({
  leading,
  title,
  subtitle,
  actions,
  className
}: PaneHeaderProps): React.JSX.Element {
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
        {subtitle && (
          <span className="text-muted-foreground truncate font-mono text-meta">{subtitle}</span>
        )}
      </div>
      {actions && <div className="no-drag flex shrink-0 items-center gap-1.5">{actions}</div>}
    </header>
  )
}
