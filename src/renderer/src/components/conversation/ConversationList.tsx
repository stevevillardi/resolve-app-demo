import { useMemo } from 'react'
import { MessagesSquare } from 'lucide-react'
import { ConversationListItem } from './ConversationListItem'
import { AvatarColorSwatch } from '@/components/common/AvatarColorSwatch'
import { EmptyState } from '@/components/common/EmptyState'
import { useUiStore } from '@/store/useUiStore'
import { usageForContact } from '@/lib/usage'
import { previewLine, repoName } from '@/lib/format'
import { cn } from '@/lib/utils'
import { contacts, groups, groupMessages, messages, personaTemplates, usageEvents } from '@/mocks'
import type { Contact, PersonaTemplate } from '@/types'

function personaFor(personaTemplateId: string): PersonaTemplate | undefined {
  return personaTemplates.find((persona) => persona.id === personaTemplateId)
}

function personaName(contact: Contact): string {
  return personaFor(contact.personaTemplateId)?.name ?? contact.displayName
}

function lastContactMessage(contactId: string): { preview: string; timestamp?: number } {
  const thread = messages.filter((message) => message.contactId === contactId)
  const last = thread[thread.length - 1]
  if (!last) return { preview: 'No messages yet' }
  if (last.status === 'error') {
    return { preview: last.error?.message ?? 'Something went wrong', timestamp: last.timestamp }
  }
  return { preview: previewLine(last.content), timestamp: last.timestamp }
}

function lastGroupMessage(groupId: string): { preview: string; timestamp?: number } {
  const thread = groupMessages.filter((message) => message.groupId === groupId)
  const last = thread[thread.length - 1]
  if (!last) return { preview: 'No activity yet' }
  return { preview: previewLine(last.content), timestamp: last.timestamp }
}

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
function GroupAvatarCluster({ repoPath }: { repoPath: string }): React.JSX.Element {
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
  const needle = query.trim().toLowerCase()

  const visibleContacts = useMemo(
    () =>
      contacts.filter(
        (contact) =>
          !needle ||
          contact.displayName.toLowerCase().includes(needle) ||
          contact.repoPath.toLowerCase().includes(needle)
      ),
    [needle]
  )

  const visibleGroups = useMemo(
    () => groups.filter((group) => !needle || group.repoPath.toLowerCase().includes(needle)),
    [needle]
  )

  if (visibleContacts.length === 0 && visibleGroups.length === 0) {
    return (
      <EmptyState
        compact
        icon={MessagesSquare}
        title="Nothing matches"
        description={`No contact or repo matching “${query.trim()}”.`}
      />
    )
  }

  return (
    <div className="flex flex-col">
      {visibleContacts.length > 0 && <SectionLabel>Contacts</SectionLabel>}
      {visibleContacts.map((contact) => {
        const persona = personaFor(contact.personaTemplateId)
        const last = lastContactMessage(contact.id)
        return (
          <ConversationListItem
            key={contact.id}
            name={personaName(contact)}
            repoPath={contact.repoPath}
            preview={last.preview}
            timestamp={last.timestamp}
            usage={usageForContact(usageEvents, contact.id)}
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
      {visibleGroups.map((group) => {
        const last = lastGroupMessage(group.id)
        return (
          <ConversationListItem
            key={group.id}
            name={repoName(group.repoPath)}
            repoPath={group.repoPath}
            preview={last.preview}
            timestamp={last.timestamp}
            active={selected?.kind === 'group' && selected.id === group.id}
            onSelect={() => setSelected({ kind: 'group', id: group.id })}
            leading={<GroupAvatarCluster repoPath={group.repoPath} />}
          />
        )
      })}
    </div>
  )
}
