/**
 * The "everything below arrived while you were away" line.
 *
 * DaySeparator's shape — a centred pill over a hairline — but in the accent
 * colour and not sticky: a date labels a region you scroll through, while this
 * marks one boundary and should scroll away once seen. Placement comes from
 * firstUnreadIndex against the boundary as it was when the thread opened; the
 * mark-read effect moves the live boundary forward on mount, and computing
 * against that would delete the divider in the frame it appeared.
 */
export function UnreadSeparator(): React.JSX.Element {
  return (
    <div className="flex items-center gap-2.5 py-1" role="separator" aria-label="New messages">
      <span className="bg-primary/30 h-px flex-1" aria-hidden />
      <span className="text-primary text-meta font-medium">New messages</span>
      <span className="bg-primary/30 h-px flex-1" aria-hidden />
    </div>
  )
}
