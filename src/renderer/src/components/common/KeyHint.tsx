import { cn } from '@/lib/utils'

/**
 * One key, or one chord, drawn as a key.
 *
 * A real `<kbd>`, because that is what it is — screen readers announce the
 * element, and the app's own copy ("press ⌘K") reads as prose without it.
 *
 * Mono for the same reason a repo path and a cron expression are mono: a key
 * name is machine text, not language. Sized off `--text-meta` rather than a
 * `text-[Npx]`, so it moves with the scale in main.css.
 *
 * Shared rather than local to the Home guide because the command palette's
 * footer already lists five shortcuts, and two surfaces that both teach
 * keyboard bindings should not draw a key two different ways — that is exactly
 * how the four pane headers drifted before Phase 13.
 */
export function KeyHint({
  children,
  className
}: {
  children: React.ReactNode
  className?: string
}): React.JSX.Element {
  return (
    <kbd
      className={cn(
        'border-border bg-muted/60 text-muted-foreground inline-flex h-5 min-w-5',
        'items-center justify-center rounded-[6px] border px-1.5',
        'font-mono text-meta font-medium tracking-normal',
        className
      )}
    >
      {children}
    </kbd>
  )
}
