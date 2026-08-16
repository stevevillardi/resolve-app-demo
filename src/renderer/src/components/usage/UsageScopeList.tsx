import { Layers } from 'lucide-react'
import { AvatarColorSwatch } from '@/components/common/AvatarColorSwatch'
import { formatCost } from '@/lib/usage'
import { cn } from '@/lib/utils'
// Still mock-fed: usage_events is only written once turns actually run, so
// this list goes live in Phase 10 (docs/plan/10-usage-cost-dashboard.md).
import { contacts, personaTemplates, usageEvents } from '@/mocks'
import { useUiStore } from '@/store/useUiStore'

function costForContactIds(contactIds: string[]): number | null {
  const ids = new Set(contactIds)
  const relevant = usageEvents.filter((event) => ids.has(event.contactId))
  const withCost = relevant.filter((event) => event.costUsd !== null)
  if (withCost.length === 0) return null
  return withCost.reduce((sum, event) => sum + (event.costUsd ?? 0), 0)
}

/** Master list for the usage section: all spend, or one persona's. */
export function UsageScopeList(): React.JSX.Element {
  const scope = useUiStore((state) => state.usageScope)
  const setScope = useUiStore((state) => state.setUsageScope)
  const allCost = costForContactIds(contacts.map((contact) => contact.id))

  const rowClass = (active: boolean): string =>
    cn(
      'flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors',
      'focus-visible:ring-ring/50 outline-none focus-visible:ring-2',
      active ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'
    )

  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={() => setScope({ kind: 'all' })}
        className={rowClass(scope.kind === 'all')}
      >
        <span className="border-border flex size-8 shrink-0 items-center justify-center rounded-lg border">
          <Layers className="text-muted-foreground size-4" />
        </span>
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium">All personas</span>
        <span className="text-muted-foreground shrink-0 font-mono text-[11px] tabular-nums">
          {formatCost(allCost)}
        </span>
      </button>

      <p className="text-muted-foreground px-2 pt-3 pb-1 text-[11px] font-medium tracking-wide uppercase">
        By persona
      </p>

      {personaTemplates.map((persona) => {
        const personaContactIds = contacts
          .filter((contact) => contact.personaTemplateId === persona.id)
          .map((contact) => contact.id)
        const active = scope.kind === 'persona' && scope.id === persona.id
        return (
          <button
            key={persona.id}
            type="button"
            onClick={() => setScope({ kind: 'persona', id: persona.id })}
            className={rowClass(active)}
          >
            <AvatarColorSwatch name={persona.name} color={persona.avatarColor} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium">{persona.name}</span>
              <span className="text-muted-foreground block text-xs">
                {personaContactIds.length} {personaContactIds.length === 1 ? 'contact' : 'contacts'}
              </span>
            </span>
            <span className="text-muted-foreground shrink-0 font-mono text-[11px] tabular-nums">
              {formatCost(costForContactIds(personaContactIds))}
            </span>
          </button>
        )
      })}
    </div>
  )
}
