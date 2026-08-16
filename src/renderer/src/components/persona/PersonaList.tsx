import { Users2 } from 'lucide-react'
import { AvatarColorSwatch } from '@/components/common/AvatarColorSwatch'
import { ScopeChip } from '@/components/common/ScopeChip'
import { EmptyState } from '@/components/common/EmptyState'
import { cn } from '@/lib/utils'
import { contacts, personaTemplates } from '@/mocks'
import { useUiStore } from '@/store/useUiStore'

export function PersonaList({ query }: { query: string }): React.JSX.Element {
  const selectedId = useUiStore((state) => state.selectedPersonaId)
  const setSelectedId = useUiStore((state) => state.setSelectedPersonaId)
  const needle = query.trim().toLowerCase()

  const visible = personaTemplates.filter(
    (persona) =>
      !needle ||
      persona.name.toLowerCase().includes(needle) ||
      persona.systemPrompt.toLowerCase().includes(needle)
  )

  if (visible.length === 0) {
    return (
      <EmptyState
        compact
        icon={Users2}
        title="No personas match"
        description={`Nothing matching “${query.trim()}”.`}
      />
    )
  }

  return (
    <div className="flex flex-col">
      {visible.map((persona) => {
        const boundCount = contacts.filter((c) => c.personaTemplateId === persona.id).length
        const active = selectedId === persona.id
        return (
          <button
            key={persona.id}
            type="button"
            onClick={() => setSelectedId(persona.id)}
            className={cn(
              'flex w-full items-start gap-2.5 rounded-lg px-2 py-2 text-left transition-colors',
              'focus-visible:ring-ring/50 outline-none focus-visible:ring-2',
              active ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'
            )}
          >
            <AvatarColorSwatch name={persona.name} color={persona.avatarColor} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium">{persona.name}</span>
              <span className="text-muted-foreground block text-xs">
                {boundCount} {boundCount === 1 ? 'contact' : 'contacts'}
              </span>
              <span className="mt-1 flex flex-wrap gap-1">
                <ScopeChip axis="sandbox" value={persona.sandbox} />
                <ScopeChip axis="github" value={persona.githubScope} />
              </span>
            </span>
          </button>
        )
      })}
    </div>
  )
}
