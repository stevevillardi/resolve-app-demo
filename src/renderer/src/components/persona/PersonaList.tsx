import { Users2 } from 'lucide-react'
import { AvatarColorSwatch } from '@/components/common/AvatarColorSwatch'
import { ScopeChip } from '@/components/common/ScopeChip'
import { EmptyState } from '@/components/common/EmptyState'
import { ListRow } from '@/components/common/ListRow'
import { useContacts } from '@/hooks/useConversations'
import { usePersonas } from '@/hooks/usePersonas'
import { useUiStore } from '@/store/useUiStore'

export function PersonaList({ query }: { query: string }): React.JSX.Element {
  const selectedId = useUiStore((state) => state.selectedPersonaId)
  const setSelectedId = useUiStore((state) => state.setSelectedPersonaId)
  const { data: personaTemplates = [], isPending } = usePersonas()
  const { data: contacts = [] } = useContacts()
  const needle = query.trim().toLowerCase()

  const visible = personaTemplates.filter(
    (persona) =>
      !needle ||
      persona.name.toLowerCase().includes(needle) ||
      persona.systemPrompt.toLowerCase().includes(needle)
  )

  if (isPending) {
    return <EmptyState compact loading title="Loading personas…" />
  }

  if (visible.length === 0) {
    return needle ? (
      <EmptyState
        compact
        icon={Users2}
        title="No personas match"
        description={`Nothing matching “${query.trim()}”.`}
      />
    ) : (
      <EmptyState
        compact
        icon={Users2}
        title="No personas yet"
        description="A persona is a system prompt, a set of skills, and a permission scope. Add one to get started."
      />
    )
  }

  return (
    <div className="flex flex-col">
      {visible.map((persona) => {
        const boundCount = contacts.filter((c) => c.personaTemplateId === persona.id).length
        const active = selectedId === persona.id
        return (
          <ListRow
            key={persona.id}
            active={active}
            onSelect={() => setSelectedId(persona.id)}
            leading={<AvatarColorSwatch name={persona.name} color={persona.avatarColor} />}
          >
            <span className="block truncate text-row font-medium">{persona.name}</span>
            <span className="text-muted-foreground block text-xs">
              {boundCount} {boundCount === 1 ? 'contact' : 'contacts'}
            </span>
            <span className="mt-1 flex flex-wrap gap-1">
              <ScopeChip axis="sandbox" value={persona.sandbox} />
              <ScopeChip axis="github" value={persona.githubScope} />
            </span>
          </ListRow>
        )
      })}
    </div>
  )
}
