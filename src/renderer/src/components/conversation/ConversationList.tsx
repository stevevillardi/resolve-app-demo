import { useMemo, useState } from 'react'
import { MessagesSquare } from 'lucide-react'
import { ConversationListItem } from './ConversationListItem'
import { ContactActionDialogs, ContactActionItems, type ContactDialogKind } from './ContactActions'
import { AvatarColorSwatch } from '@/components/common/AvatarColorSwatch'
import { ContextMenuContent } from '@/components/ui/context-menu'
import { botttsDataUri } from '@/lib/avatar'
import { EmptyState } from '@/components/common/EmptyState'
import { Button } from '@/components/ui/button'
import { useContacts, useGroups } from '@/hooks/useConversations'
import { usePersonas } from '@/hooks/usePersonas'
import { useActiveRuns, useMessagePreviews } from '@/hooks/useMessages'
import { useGroupMessagePreviews } from '@/hooks/useGroupMessages'
import { useUnread } from '@/hooks/useUnread'
import { useUsageEvents } from '@/hooks/useUsage'
import { useUiStore } from '@/store/useUiStore'
import { byRecency } from '@/lib/conversation-sort'
import { previewLine, repoName } from '@/lib/format'
import { usageForContact, usageForContacts } from '@/lib/usage'
import { cn } from '@/lib/utils'
import type { Contact, PersonaBackend, PersonaTemplate } from '@/types'

/**
 * Every row is real as of Phase 6 — contacts and groups came in Phase 4, and
 * the preview, timestamp and cost that had been reading "No messages yet" now
 * come from the `messages` and `usage_events` rows a turn actually writes.
 *
 * A group's figures are its members' summed, since a group has no session of
 * its own (blueprint §8: it is a merged view and a router).
 */

function SectionLabel({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <p className="text-muted-foreground px-2 pt-3 pb-1 text-meta font-medium tracking-wide uppercase first:pt-1">
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
          className={cn(
            'flex items-center justify-center overflow-hidden',
            members.length === 3 && index === 0 && 'col-span-2'
          )}
          style={{ backgroundColor: `color-mix(in srgb, ${persona.avatarColor} 16%, transparent)` }}
        >
          <img
            src={botttsDataUri(persona.id, persona.avatarColor)}
            alt=""
            draggable={false}
            className="size-full object-contain"
          />
        </span>
      ))}
    </span>
  )
}

/**
 * A contact row plus its right-click menu and that menu's dialogs.
 *
 * The row-level component exists because each row needs its own dialog state:
 * the actions themselves are the same ContactActionItems the thread header's
 * ⋯ menu renders, so right-clicking a conversation offers exactly what opening
 * it would — without the detour.
 */
function ContactRow({
  contact,
  backend,
  ...item
}: Omit<React.ComponentProps<typeof ConversationListItem>, 'repoPath' | 'contextMenu'> & {
  contact: Contact
  backend: PersonaBackend
}): React.JSX.Element {
  const [dialog, setDialog] = useState<ContactDialogKind | null>(null)

  return (
    <>
      <ConversationListItem
        {...item}
        repoPath={contact.repoPath}
        contextMenu={
          <ContextMenuContent>
            <ContactActionItems
              kind="context"
              contactId={contact.id}
              workingPath={contact.worktreePath ?? contact.repoPath}
              hasSession={contact.backendSessionId !== null}
              onOpen={setDialog}
            />
          </ContextMenuContent>
        }
      />
      <ContactActionDialogs
        contact={contact}
        backend={backend}
        open={dialog}
        onClose={() => setDialog(null)}
      />
    </>
  )
}

export function ConversationList({ query }: { query: string }): React.JSX.Element {
  const selected = useUiStore((state) => state.selectedConversation)
  const setSelected = useUiStore((state) => state.setSelectedConversation)
  const setDialog = useUiStore((state) => state.setDialog)
  const { data: contacts = [], isPending } = useContacts()
  const { data: groups = [] } = useGroups()
  const { data: personaTemplates = [] } = usePersonas()
  const { data: previews = [] } = useMessagePreviews()
  const { data: groupPreviews = [] } = useGroupMessagePreviews()
  const { data: usageEvents = [] } = useUsageEvents()
  const { data: runs = [] } = useActiveRuns()
  const unread = useUnread()
  const needle = query.trim().toLowerCase()

  const previewFor = useMemo(
    () => (contactId: string) => previews.find((message) => message.contactId === contactId),
    [previews]
  )

  // Undefined rather than a zeroed summary when a contact has never run: the
  // badge should be absent, not read "$0.00", which claims a turn was free.
  const usageFor = useMemo(
    () => (contactId: string) => {
      if (!usageEvents.some((event) => event.contactId === contactId)) return undefined
      return usageForContact(usageEvents, contactId)
    },
    [usageEvents]
  )

  const personaFor = useMemo(
    () =>
      (id: string): PersonaTemplate | undefined =>
        personaTemplates.find((persona) => persona.id === id),
    [personaTemplates]
  )

  // Recency-sorted within each section (Phase 20): the services return
  // alphabetical, which suits a phone book, not a messages app. The preview —
  // already fetched for the row's own subtitle — is the timestamp authority.
  const visibleContacts = useMemo(
    () =>
      byRecency(
        contacts.filter(
          (contact) =>
            !needle ||
            contact.displayName.toLowerCase().includes(needle) ||
            contact.repoPath.toLowerCase().includes(needle)
        ),
        (contact) => previews.find((message) => message.contactId === contact.id)?.timestamp,
        (contact) => contact.displayName
      ),
    [contacts, needle, previews]
  )

  const visibleGroups = useMemo(
    () =>
      byRecency(
        groups.filter((group) => !needle || group.repoPath.toLowerCase().includes(needle)),
        (group) => groupPreviews.find((message) => message.groupId === group.id)?.timestamp,
        (group) => repoName(group.repoPath)
      ),
    [groups, needle, groupPreviews]
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
        const latest = previewFor(contact.id)
        return (
          <ContactRow
            key={contact.id}
            contact={contact}
            backend={persona?.backend ?? 'claude'}
            name={persona?.name ?? contact.displayName}
            // previewLine strips the markdown an assistant reply is full of —
            // a row showing "## Findings" reads as a bug rather than a preview.
            preview={latest ? previewLine(latest.content) : 'No messages yet'}
            {...(latest && { timestamp: latest.timestamp })}
            {...(usageFor(contact.id) && { usage: usageFor(contact.id) })}
            running={runs.some((run) => run.contactId === contact.id)}
            unread={unread.get(`contact:${contact.id}`) ?? 0}
            active={selected?.kind === 'contact' && selected.id === contact.id}
            onSelect={() => setSelected({ kind: 'contact', id: contact.id })}
            leading={
              <AvatarColorSwatch
                name={persona?.name ?? contact.displayName}
                color={persona?.avatarColor ?? 'var(--muted)'}
                seed={persona?.id}
              />
            }
          />
        )
      })}

      {visibleGroups.length > 0 && <SectionLabel>Repo groups</SectionLabel>}
      {visibleGroups.map((group) => {
        const memberIds = contacts
          .filter((contact) => contact.repoPath === group.repoPath)
          .map((contact) => contact.id)
        const memberUsage = usageEvents.some(
          (event) => event.contactId !== null && memberIds.includes(event.contactId)
        )
          ? usageForContacts(usageEvents, memberIds)
          : undefined
        // The group's own log, not its members' 1:1 threads — a group row
        // should preview what happened *in the group*, which since Phase 7
        // means session summaries, mentions, and routed replies.
        const latest = groupPreviews.find((message) => message.groupId === group.id)

        return (
          <ConversationListItem
            key={group.id}
            name={repoName(group.repoPath)}
            repoPath={group.repoPath}
            preview={
              memberIds.length === 0
                ? 'No contacts yet'
                : latest
                  ? previewLine(latest.content)
                  : 'No activity yet'
            }
            {...(latest && { timestamp: latest.timestamp })}
            {...(memberUsage && { usage: memberUsage })}
            // A group is a merged view of its members, so it is "running" when
            // any contact bound to its repo is.
            running={runs.some((run) => memberIds.includes(run.contactId))}
            unread={unread.get(`group:${group.id}`) ?? 0}
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
        )
      })}
    </div>
  )
}
