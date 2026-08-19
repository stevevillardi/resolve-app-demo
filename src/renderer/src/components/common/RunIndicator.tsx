import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { RunRow } from '@/components/common/RunRow'
import { useCancelRun } from '@/hooks/useMessages'
import { useNow } from '@/hooks/useNow'
import { runTarget } from '@/lib/run-view'
import { useUiStore } from '@/store/useUiStore'
import { cn } from '@/lib/utils'
import { useState } from 'react'
import type { ActiveRun } from '../../../../shared/ipc-contract'

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
  runs,
  expanded
}: {
  runs: ActiveRun[]
  expanded: boolean
}): React.JSX.Element | null {
  const [open, setOpen] = useState(false)
  const now = useNow(open && runs.length > 0)
  const { cancel } = useCancelRun()
  const setSection = useUiStore((state) => state.setSection)
  const setSelectedConversation = useUiStore((state) => state.setSelectedConversation)

  if (runs.length === 0) return null

  const count = runs.length
  const label = `${count} ${count === 1 ? 'run' : 'runs'} in progress`

  return (
    <Popover open={open} onOpenChange={setOpen}>
      {/* A button, at last: "3 running" with no way to get to them was the
          Phase 25 complaint about this mark in one line. */}
      <PopoverTrigger
        render={
          <button
            type="button"
            aria-label={label}
            className={cn(
              'text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 flex h-8 items-center gap-2 rounded-md outline-none focus-visible:ring-2',
              // Collapsed, it takes the same 40px box as the rail's icon
              // buttons (size-10) rather than the footer's full content width —
              // centring in the wider box would put the mark a few pixels off
              // their centre line.
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
          </button>
        }
      />
      <PopoverContent side="right" align="end" className="w-80 p-2">
        <p className="text-muted-foreground px-1 pb-2 font-mono text-micro tracking-wide uppercase">
          {label}
        </p>
        <div className="flex flex-col gap-1.5">
          {runs.map((run) => (
            <RunRow
              key={run.runId}
              run={run}
              now={now}
              onStop={cancel}
              onOpen={(target) => {
                const destination = runTarget(target)
                setSection('chats')
                setSelectedConversation(destination)
                setOpen(false)
              }}
            />
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
