import { useState } from 'react'
import { Clock, Pause, Play, Trash2, Zap } from 'lucide-react'
import { toast } from 'sonner'
import { AvatarColorSwatch } from '@/components/common/AvatarColorSwatch'
import { RunPulse } from '@/components/common/RunIndicator'
import { ConfirmDeleteDialog } from '@/components/common/ConfirmDeleteDialog'
import { EmptyState } from '@/components/common/EmptyState'
import { ListRow } from '@/components/common/ListRow'
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator
} from '@/components/ui/context-menu'
import { formatRelative } from '@/lib/format'
import { formatElapsed } from '@/lib/home'
import { routineRun } from '@/lib/run-view'
import { cn } from '@/lib/utils'
import { useContacts } from '@/hooks/useConversations'
import { usePersonas } from '@/hooks/usePersonas'
import {
  useDeleteRoutine,
  useRoutines,
  useRunRoutineNow,
  useUpdateRoutine
} from '@/hooks/useRoutines'
import { useActiveRuns } from '@/hooks/useMessages'
import { useNow } from '@/hooks/useNow'
import { useUiStore } from '@/store/useUiStore'
import type { Routine } from '@/types'

/**
 * Right-click actions for a routine row — the enable toggle, run-now and
 * delete that otherwise require opening the editor. Run-now toasts its
 * outcome because from the list there is no pane for the skip refusal to
 * land in; pause/resume shows itself (the row dims), so it stays quiet.
 */
function RoutineRowMenu({ routine }: { routine: Routine }): React.JSX.Element {
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const selectedId = useUiStore((state) => state.selectedRoutineId)
  const setSelectedId = useUiStore((state) => state.setSelectedRoutineId)
  const { save } = useUpdateRoutine()
  const { runNow } = useRunRoutineNow()
  const { remove } = useDeleteRoutine()

  const toggle = (): void =>
    save({
      id: routine.id,
      contactId: routine.contactId,
      schedule: routine.schedule,
      prompt: routine.prompt,
      enabled: !routine.enabled,
      monthlyBudgetUsd: routine.monthlyBudgetUsd
    })

  return (
    <>
      <ContextMenuContent>
        <ContextMenuItem onClick={toggle}>
          {routine.enabled ? <Pause /> : <Play />}
          {routine.enabled ? 'Pause' : 'Resume'}
        </ContextMenuItem>
        <ContextMenuItem
          onClick={() =>
            runNow(routine.id, (result) =>
              toast(result.skipped ? `Skipped — ${result.skipped}` : 'Run started')
            )
          }
        >
          <Zap />
          Run now
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" onClick={() => setConfirmingDelete(true)}>
          <Trash2 />
          Delete routine…
        </ContextMenuItem>
      </ContextMenuContent>

      {confirmingDelete && (
        <ConfirmDeleteDialog
          open
          onOpenChange={(next) => !next && setConfirmingDelete(false)}
          title="Delete this routine?"
          description="It stops firing immediately. The conversation it has been having with its contact is kept."
          onConfirm={() =>
            remove(routine.id, () => {
              setConfirmingDelete(false)
              if (selectedId === routine.id) setSelectedId(null)
            })
          }
        />
      )}
    </>
  )
}

export function RoutineList({ query }: { query: string }): React.JSX.Element {
  const selectedId = useUiStore((state) => state.selectedRoutineId)
  const setSelectedId = useUiStore((state) => state.setSelectedRoutineId)
  const needle = query.trim().toLowerCase()

  const { data: routines = [], isPending } = useRoutines()
  const contacts = useContacts().data ?? []
  const personaTemplates = usePersonas().data ?? []
  // Live state: a routine mid-fire must not read "Last run 3 days ago" — that
  // was the Phase 25 complaint in one sentence. Elapsed ticks only while
  // something is actually running.
  const { data: runs = [] } = useActiveRuns()
  const anyRoutineRunning = runs.some((run) => run.origin === 'routine')
  const now = useNow(anyRoutineRunning)

  const visible = routines.filter(
    (routine) =>
      !needle ||
      routine.prompt.toLowerCase().includes(needle) ||
      routine.schedule.toLowerCase().includes(needle)
  )

  // Before the two nothings below: "not loaded yet" is a third state, and
  // showing "No routines yet" during the first fetch tells the user something
  // that is not true.
  if (isPending) return <EmptyState compact loading title="Loading routines…" />

  if (visible.length === 0) {
    // Two different nothings: a filter that matched nothing, and a section
    // nobody has used yet. The second one names the next action.
    return needle ? (
      <EmptyState
        compact
        icon={Clock}
        title="No routines match"
        description={`Nothing matching “${query.trim()}”.`}
      />
    ) : (
      <EmptyState
        compact
        icon={Clock}
        title="No routines yet"
        description="A routine wakes a contact on a schedule and posts what it did to the repo group."
      />
    )
  }

  return (
    <div className="flex flex-col">
      {visible.map((routine) => {
        const contact = contacts.find((c) => c.id === routine.contactId)
        const persona = personaTemplates.find((p) => p.id === contact?.personaTemplateId)
        const active = selectedId === routine.id
        return (
          <ListRow
            key={routine.id}
            active={active}
            onSelect={() => setSelectedId(routine.id)}
            contextMenu={<RoutineRowMenu routine={routine} />}
            leading={
              <span className="relative shrink-0">
                <AvatarColorSwatch
                  name={persona?.name ?? 'Routine'}
                  color={persona?.avatarColor ?? 'var(--muted)'}
                  seed={persona?.avatarSeed}
                />
                {/* Disabled routines are dimmed rather than hidden — a routine
                    that exists but isn't running is worth seeing. */}
                {!routine.enabled && (
                  <span className="bg-card/70 absolute inset-0 rounded-lg" aria-hidden />
                )}
              </span>
            }
          >
            <span className={cn('block', !routine.enabled && 'opacity-60')}>
              <span className="flex items-baseline justify-between gap-2">
                <span className="truncate text-row font-medium">
                  {persona?.name ?? 'Unknown persona'}
                </span>
                <span className="text-muted-foreground shrink-0 font-mono text-micro">
                  {routine.schedule}
                </span>
              </span>
              <span className="text-muted-foreground mt-0.5 block truncate text-xs">
                {routine.prompt}
              </span>
              {(() => {
                const live = routineRun(runs, routine.id)
                if (live) {
                  return (
                    <span className="text-primary mt-0.5 flex items-center gap-1.5 text-meta">
                      <RunPulse />
                      Running · {formatElapsed(live.startedAt, now)}
                    </span>
                  )
                }
                return (
                  <span className="text-muted-foreground mt-0.5 block text-meta">
                    {routine.enabled
                      ? routine.lastRunAt
                        ? `Last run ${formatRelative(routine.lastRunAt)}`
                        : 'Never run'
                      : 'Paused'}
                  </span>
                )
              })()}
              {/* Outstanding misses, in the warning register rather than the
                  destructive one — nothing failed, something silently didn't
                  happen. Cleared by any attempt, so a healthy routine never
                  shows this line. */}
              {routine.missedRunCount > 0 && (
                <span className="text-scope-elevated mt-0.5 block text-meta">
                  Missed{' '}
                  {routine.missedRunCount === 1
                    ? '1 scheduled run'
                    : `${routine.missedRunCount} scheduled runs`}
                </span>
              )}
            </span>
          </ListRow>
        )
      })}
    </div>
  )
}
