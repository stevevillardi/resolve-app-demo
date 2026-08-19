import { useState } from 'react'
import { CopyPlus, Trash2, Users2 } from 'lucide-react'
import { AvatarColorSwatch } from '@/components/common/AvatarColorSwatch'
import { ConfirmDeleteDialog } from '@/components/common/ConfirmDeleteDialog'
import { ScopeChip } from '@/components/common/ScopeChip'
import { EmptyState } from '@/components/common/EmptyState'
import { ListRow } from '@/components/common/ListRow'
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator
} from '@/components/ui/context-menu'
import { useContacts } from '@/hooks/useConversations'
import { useCreatePersona, useDeletePersona, usePersonas } from '@/hooks/usePersonas'
import { useUiStore } from '@/store/useUiStore'
import type { PersonaTemplate } from '@/types'

/**
 * Right-click actions for one persona row. Delete opens the same dialog the
 * editor's trash icon does — same copy, same main-side refusal while contacts
 * are bound. Duplicate is the row-only affordance: the editor edits what
 * exists, but "one like this" starts from the list.
 */
function PersonaRowMenu({
  persona,
  boundCount
}: {
  persona: PersonaTemplate
  boundCount: number
}): React.JSX.Element {
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const selectedId = useUiStore((state) => state.selectedPersonaId)
  const setSelectedId = useUiStore((state) => state.setSelectedPersonaId)
  const { create } = useCreatePersona()
  const { remove } = useDeletePersona()

  const duplicate = (): void => {
    // Fields listed explicitly, like every persisted write in this repo — a
    // spread of the row would silently carry any future server-owned field
    // into the create payload.
    create(
      {
        name: `${persona.name} copy`,
        avatarColor: persona.avatarColor,
        backend: persona.backend,
        model: persona.model,
        systemPrompt: persona.systemPrompt,
        skillIds: persona.skillIds,
        mcpServerIds: persona.mcpServerIds,
        sandbox: persona.sandbox,
        githubScope: persona.githubScope
      },
      (copy) => setSelectedId(copy.id)
    )
  }

  return (
    <>
      <ContextMenuContent>
        <ContextMenuItem onClick={duplicate}>
          <CopyPlus />
          Duplicate
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" onClick={() => setConfirmingDelete(true)}>
          <Trash2 />
          Delete persona…
        </ContextMenuItem>
      </ContextMenuContent>

      {confirmingDelete && (
        <ConfirmDeleteDialog
          open
          onOpenChange={(next) => !next && setConfirmingDelete(false)}
          title={`Delete “${persona.name}”?`}
          // Main refuses outright while contacts are bound, so this branch is a
          // heads-up rather than the real gate — the authoritative check and
          // its message come back from the service.
          description={
            boundCount === 0
              ? 'This removes the persona and its instructions. Skills it attaches are untouched.'
              : `${boundCount} contact${boundCount === 1 ? ' is' : 's are'} still bound to it, so this will be refused.`
          }
          onConfirm={() =>
            remove(persona.id, () => {
              setConfirmingDelete(false)
              if (selectedId === persona.id) setSelectedId(null)
            })
          }
        />
      )}
    </>
  )
}

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
            leading={
              <AvatarColorSwatch
                name={persona.name}
                color={persona.avatarColor}
                seed={persona.avatarSeed}
              />
            }
            contextMenu={<PersonaRowMenu persona={persona} boundCount={boundCount} />}
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
