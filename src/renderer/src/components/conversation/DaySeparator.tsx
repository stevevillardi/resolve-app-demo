import { formatDaySeparator } from '@/lib/format'

/**
 * Threads here span days (routines fire nightly), so a run of messages with
 * only clock times is ambiguous. Sticky so the date stays visible while you
 * scroll through a long day.
 */
export function DaySeparator({ timestamp }: { timestamp: number }): React.JSX.Element {
  return (
    <div className="sticky top-0 z-10 flex justify-center py-1">
      <span className="bg-background/80 text-muted-foreground rounded-full px-2.5 py-0.5 text-meta font-medium backdrop-blur-sm">
        {formatDaySeparator(timestamp)}
      </span>
    </div>
  )
}
