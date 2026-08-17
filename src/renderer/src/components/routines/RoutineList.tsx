import { Clock } from 'lucide-react'
import { AvatarColorSwatch } from '@/components/common/AvatarColorSwatch'
import { EmptyState } from '@/components/common/EmptyState'
import { ListRow } from '@/components/common/ListRow'
import { formatRelative } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useContacts } from '@/hooks/useConversations'
import { usePersonas } from '@/hooks/usePersonas'
import { useRoutines } from '@/hooks/useRoutines'
import { useUiStore } from '@/store/useUiStore'

export function RoutineList({ query }: { query: string }): React.JSX.Element {
  const selectedId = useUiStore((state) => state.selectedRoutineId)
  const setSelectedId = useUiStore((state) => state.setSelectedRoutineId)
  const needle = query.trim().toLowerCase()

  const { data: routines = [], isPending } = useRoutines()
  const contacts = useContacts().data ?? []
  const personaTemplates = usePersonas().data ?? []

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
            leading={
              <span className="relative shrink-0">
                <AvatarColorSwatch
                  name={persona?.name ?? 'Routine'}
                  color={persona?.avatarColor ?? 'var(--muted)'}
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
              <span className="text-muted-foreground mt-0.5 block text-meta">
                {routine.enabled
                  ? routine.lastRunAt
                    ? `Last run ${formatRelative(routine.lastRunAt)}`
                    : 'Never run'
                  : 'Paused'}
              </span>
            </span>
          </ListRow>
        )
      })}
    </div>
  )
}
