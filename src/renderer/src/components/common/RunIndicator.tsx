import { useState } from 'react'
import { Activity } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { SidebarMenuButton } from '@/components/ui/sidebar'
import { EmptyState } from '@/components/common/EmptyState'
import { RunRow } from '@/components/common/RunRow'
import { useCancelRun } from '@/hooks/useMessages'
import { useNow } from '@/hooks/useNow'
import { runTarget } from '@/lib/run-view'
import { RAIL_BUTTON } from '@/lib/nav-items'
import { useUiStore } from '@/store/useUiStore'
import { cn } from '@/lib/utils'
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
 * The fleet activity button, at the bottom of the nav rail.
 *
 * A permanent rail button in the same register as the GitHub status button —
 * an icon, a label, and a corner mark when something is live — rather than a
 * mark that only exists while running: a control that appears and vanishes
 * cannot be learned, and an idle click deserves an answer ("nothing running")
 * instead of nothing to click. The popover lists every in-flight turn with
 * who, where, why (origin chip), elapsed, Stop, and a click-through to the
 * conversation.
 */
export function RunIndicator({ runs }: { runs: ActiveRun[] }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const now = useNow(open && runs.length > 0)
  const { cancel } = useCancelRun()
  const setSection = useUiStore((state) => state.setSection)
  const setSelectedConversation = useUiStore((state) => state.setSelectedConversation)

  const count = runs.length
  const label =
    count === 0
      ? 'Activity — nothing running'
      : `Activity — ${count} ${count === 1 ? 'run' : 'runs'} in progress`

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <SidebarMenuButton
            tooltip={label}
            aria-label={label}
            className={cn('relative', RAIL_BUTTON)}
          >
            <Activity />
            <span className="group-data-[collapsible=icon]:hidden">Activity</span>
            {count > 0 && (
              <>
                {/* Pinned to the icon's corner, the same spot the GitHub
                    button puts its status dot — and pulsing, because this one
                    means "right now". */}
                <RunPulse className="absolute top-2 left-5" />
                <span className="text-primary ml-auto font-mono text-meta tabular-nums group-data-[collapsible=icon]:hidden">
                  {count}
                </span>
              </>
            )}
          </SidebarMenuButton>
        }
      />
      <PopoverContent side="right" align="end" className="w-80 p-2">
        {count === 0 ? (
          <EmptyState
            compact
            icon={Activity}
            title="Nothing running"
            description="Persona turns and routine fires show up here live, with elapsed time and a stop control."
          />
        ) : (
          <>
            <p className="text-muted-foreground px-1 pb-2 font-mono text-micro tracking-wide uppercase">
              {count} {count === 1 ? 'run' : 'runs'} in progress
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
          </>
        )}
      </PopoverContent>
    </Popover>
  )
}
