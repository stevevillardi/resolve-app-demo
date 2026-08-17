import { cn } from '@/lib/utils'

/**
 * A persona is working right now.
 *
 * Two concentric marks rather than a spinner: a run has no measurable progress
 * to report, and a spinner at an unknown percentage reads as a hang. The outer
 * ring pulses, the inner dot stays solid, so the mark is still legible when
 * motion is off (the global prefers-reduced-motion rule collapses the pulse).
 *
 * Deliberately colour-plus-shape, not colour alone.
 */
export function RunPulse({ className }: { className?: string }): React.JSX.Element {
  return (
    <span className={cn('relative flex size-2 shrink-0', className)} aria-hidden>
      <span className="bg-primary absolute inline-flex size-full animate-ping rounded-full opacity-60" />
      <span className="bg-primary relative inline-flex size-2 rounded-full" />
    </span>
  )
}

/**
 * The fleet status line, for the bottom of the nav rail.
 *
 * The count is the point, so it is set in the mono face with tabular figures —
 * the same rule every other machine figure in the app follows, which is what
 * makes this read as a console status line rather than a notification badge.
 *
 * Renders nothing at zero: a permanent "0 running" is noise, and the absence of
 * the mark is already the idle state.
 */
export function RunIndicator({
  count,
  expanded
}: {
  count: number
  expanded: boolean
}): React.JSX.Element | null {
  if (count === 0) return null

  const label = `${count} ${count === 1 ? 'run' : 'runs'} in progress`

  return (
    <div
      className={cn(
        'text-muted-foreground flex h-8 items-center gap-2',
        // Collapsed, it takes the same 40px box as the rail's icon buttons
        // (size-10) rather than the footer's full content width — centring in
        // the wider box would put the mark a few pixels off their centre line.
        expanded ? 'px-2' : 'w-10 justify-center'
      )}
      title={expanded ? undefined : label}
    >
      <RunPulse />
      {expanded ? (
        <span className="truncate font-mono text-meta tabular-nums">{count} running</span>
      ) : (
        <span className="sr-only">{label}</span>
      )}
    </div>
  )
}
