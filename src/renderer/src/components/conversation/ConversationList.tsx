import { useMemo } from 'react'
import { MessagesSquare } from 'lucide-react'
import { ConversationListItem } from './ConversationListItem'
import { AvatarColorSwatch } from '@/components/common/AvatarColorSwatch'
import { EmptyState } from '@/components/common/EmptyState'
import { Button } from '@/components/ui/button'
import { useContacts, useGroups } from '@/hooks/useConversations'
import { usePersonas } from '@/hooks/usePersonas'
import { useUiStore } from '@/store/useUiStore'
import { repoName } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { Contact, PersonaTemplate } from '@/types'

/**
 * Contacts and groups are real rows as of Phase 4. The per-row preview,
 * timestamp, and usage badge are not: their producers are the `messages` and
 * `usage_events` tables, which stay empty until a turn actually runs in
 * Phase 6. Rather than fill them from mocks — fabricated activity next to real
 * conversations — the rows say plainly that nothing has happened yet.
 */

function SectionLabel({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <p className="text-muted-foreground px-2 pt-3 pb-1 text-[11px] font-medium tracking-wide uppercase first:pt-1">
      {children}
    </p>
  )
}

/**
 * Groups get a stacked cluster of their members' avatars rather than a generic
 * icon — at a glance you can see *who* is working in a repo, which is the only
 * thing a group is for (blueprint §8: it is a merged view and router, not a
 * session of its own).
 */
function GroupAvatarCluster({
  repoPath,
  contacts,
  personaFor
}: {
  repoPath: string
  contacts: Contact[]
  personaFor: (id: string) => PersonaTemplate | undefined
}): React.JSX.Element {
  const members = contacts
    .filter((contact) => contact.repoPath === repoPath)
    .map((contact) => personaFor(contact.personaTemplateId))
    .filter((persona): persona is PersonaTemplate => Boolean(persona))
    .slice(0, 3)

  if (members.length === 0) {
    return <span className="bg-muted size-8 shrink-0 rounded-lg" />
  }

  return (
    <span
      aria-hidden
      className={cn(
        'grid size-8 shrink-0 gap-px overflow-hidden rounded-lg',
        members.length === 1 ? 'grid-cols-1' : 'grid-cols-2'
      )}
    >
      {members.map((persona, index) => (
        <span
          key={persona.id}
          // Three members: the first spans the top row, the other two split
          // the bottom — a filled tile, never an awkward gap.
          className={cn(members.length === 3 && index === 0 && 'col-span-2')}
          style={{ backgroundColor: persona.avatarColor }}
        />
      ))}
    </span>
  )
}

export function ConversationList({ query }: { query: string }): React.JSX.Element {
  const selected = useUiStore((state) => state.selectedConversation)
  const setSelected = useUiStore((state) => state.setSelectedConversation)
  const setDialog = useUiStore((state) => state.setDialog)
  const { data: contacts = [], isPending } = useContacts()
  const { data: groups = [] } = useGroups()
  const { data: personaTemplates = [] } = usePersonas()
  const needle = query.trim().toLowerCase()

  const personaFor = useMemo(
    () =>
      (id: string): PersonaTemplate | undefined =>
        personaTemplates.find((persona) => persona.id === id),
    [personaTemplates]
  )

  const visibleContacts = useMemo(
    () =>
      contacts.filter(
        (contact) =>
          !needle ||
          contact.displayName.toLowerCase().includes(needle) ||
          contact.repoPath.toLowerCase().includes(needle)
      ),
    [contacts, needle]
  )

  const visibleGroups = useMemo(
    () => groups.filter((group) => !needle || group.repoPath.toLowerCase().includes(needle)),
    [groups, needle]
  )

  if (isPending) {
    return <EmptyState compact loading title="Loading conversations…" />
  }

  if (visibleContacts.length === 0 && visibleGroups.length === 0) {
    return needle ? (
      <EmptyState
        compact
        icon={MessagesSquare}
        title="Nothing matches"
        description={`No contact or repo matching “${query.trim()}”.`}
      />
    ) : (
      <EmptyState
        compact
        icon={MessagesSquare}
        title="No contacts yet"
        description="A contact is one persona bound to one repo. Create one to start a conversation."
        action={
          <Button size="sm" variant="outline" onClick={() => setDialog('newContact')}>
            New contact
          </Button>
        }
      />
    )
  }

  return (
    <div className="flex flex-col">
      {visibleContacts.length > 0 && <SectionLabel>Contacts</SectionLabel>}
      {visibleContacts.map((contact) => {
        const persona = personaFor(contact.personaTemplateId)
        return (
          <ConversationListItem
            key={contact.id}
            name={persona?.name ?? contact.displayName}
            repoPath={contact.repoPath}
            preview="No messages yet"
            active={selected?.kind === 'contact' && selected.id === contact.id}
            onSelect={() => setSelected({ kind: 'contact', id: contact.id })}
            leading={
              <AvatarColorSwatch
                name={persona?.name ?? contact.displayName}
                color={persona?.avatarColor ?? 'var(--muted)'}
              />
            }
          />
        )
      })}

      {visibleGroups.length > 0 && <SectionLabel>Repo groups</SectionLabel>}
      {visibleGroups.map((group) => (
        <ConversationListItem
          key={group.id}
          name={repoName(group.repoPath)}
          repoPath={group.repoPath}
          preview="No activity yet"
          active={selected?.kind === 'group' && selected.id === group.id}
          onSelect={() => setSelected({ kind: 'group', id: group.id })}
          leading={
            <GroupAvatarCluster
              repoPath={group.repoPath}
              contacts={contacts}
              personaFor={personaFor}
            />
          }
        />
      ))}
    </div>
  )
}
