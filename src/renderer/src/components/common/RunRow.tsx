import { Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { RunPulse } from '@/components/common/RunIndicator'
import { repoName } from '@/lib/format'
import { formatElapsed } from '@/lib/home'
import { originLabel } from '@/lib/run-view'
import type { ActiveRun } from '../../../../shared/ipc-contract'

/**
 * One in-flight turn, wherever a fleet surface lists them — Home's running
 * section and the nav-rail popover share this row, so both stay identical. The
 * origin chip carries the answer a name alone cannot give: "routine" next to a
 * contact says a schedule started this, not you.
 */
export function RunRow({
  run,
  now,
  onStop,
  onOpen
}: {
  run: ActiveRun
  now: number
  onStop: (runId: string) => void
  /** When set, the row itself is clickable and lands in the conversation. */
  onOpen?: (run: ActiveRun) => void
}): React.JSX.Element {
  const body = (
    <>
      <RunPulse />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-row font-medium">{run.contactName}</span>
        <span className="text-muted-foreground block truncate font-mono text-meta">
          {repoName(run.workingPath)}
        </span>
      </span>
      <span className="text-muted-foreground border-border shrink-0 rounded-full border px-1.5 py-px font-mono text-micro">
        {originLabel(run.origin)}
      </span>
      <span className="text-muted-foreground shrink-0 font-mono text-meta tabular-nums">
        {formatElapsed(run.startedAt, now)}
      </span>
    </>
  )

  const stop = (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={`Stop ${run.contactName}`}
      onClick={(event) => {
        event.stopPropagation()
        onStop(run.runId)
      }}
    >
      <Square className="size-3.5" />
    </Button>
  )

  if (!onOpen) {
    return (
      <div className="border-border flex items-center gap-2.5 rounded-lg border px-2.5 py-2">
        {body}
        {stop}
      </div>
    )
  }

  return (
    <div className="border-border hover:bg-accent/50 flex items-center gap-2.5 rounded-lg border px-2.5 py-2 transition-colors">
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-2.5 text-left outline-none"
        onClick={() => onOpen(run)}
        aria-label={`Open ${run.contactName}'s conversation`}
      >
        {body}
      </button>
      {stop}
    </div>
  )
}
