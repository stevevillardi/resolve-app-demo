import { Clock } from 'lucide-react'
import { AvatarColorSwatch } from '@/components/common/AvatarColorSwatch'
import { EmptyState } from '@/components/common/EmptyState'
import { formatRelative } from '@/lib/format'
import { cn } from '@/lib/utils'
import { contacts, personaTemplates, routines } from '@/mocks'
import { useUiStore } from '@/store/useUiStore'

export function RoutineList({ query }: { query: string }): React.JSX.Element {
  const selectedId = useUiStore((state) => state.selectedRoutineId)
  const setSelectedId = useUiStore((state) => state.setSelectedRoutineId)
  const needle = query.trim().toLowerCase()

  const visible = routines.filter(
    (routine) =>
      !needle ||
      routine.prompt.toLowerCase().includes(needle) ||
      routine.schedule.toLowerCase().includes(needle)
  )

  if (visible.length === 0) {
    return (
      <EmptyState
        compact
        icon={Clock}
        title="No routines match"
        description={`Nothing matching “${query.trim()}”.`}
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
          <button
            key={routine.id}
            type="button"
            onClick={() => setSelectedId(routine.id)}
            className={cn(
              'flex w-full items-start gap-2.5 rounded-lg px-2 py-2 text-left transition-colors',
              'focus-visible:ring-ring/50 outline-none focus-visible:ring-2',
              active ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'
            )}
          >
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
            <span className={cn('min-w-0 flex-1', !routine.enabled && 'opacity-60')}>
              <span className="flex items-baseline justify-between gap-2">
                <span className="truncate text-[13px] font-medium">
                  {persona?.name ?? 'Unknown persona'}
                </span>
                <span className="text-muted-foreground shrink-0 font-mono text-[10px]">
                  {routine.schedule}
                </span>
              </span>
              <span className="text-muted-foreground mt-0.5 block truncate text-xs">
                {routine.prompt}
              </span>
              <span className="text-muted-foreground mt-0.5 block text-[11px]">
                {routine.enabled
                  ? routine.lastRunAt
                    ? `Last run ${formatRelative(routine.lastRunAt)}`
                    : 'Never run'
                  : 'Paused'}
              </span>
            </span>
          </button>
        )
      })}
    </div>
  )
}
