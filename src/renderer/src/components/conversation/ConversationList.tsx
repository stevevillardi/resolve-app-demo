import { useEffect, useMemo, useState } from 'react'
import { MessagesSquare } from 'lucide-react'
import { ConversationListItem } from './ConversationListItem'
import { ContactActionDialogs, ContactActionItems, type ContactDialogKind } from './ContactActions'
import { GroupActionDialogs, GroupActionItems, type GroupDialogKind } from './GroupActions'
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
import { useUsageSummaries } from '@/hooks/useUsage'
import { useUiStore } from '@/store/useUiStore'
import { stepConversation, type ConversationRef } from '@/lib/conversation-nav'
import { byRecency } from '@/lib/conversation-sort'
import {
  filterList,
  hasQuery,
  isFiltering,
  noMatchDescription,
  type ListFilter
} from '@/lib/list-filter'
import { FACET_PERSONA, FACET_REPO, FACET_STATE, STATE_UNREAD } from '@/lib/section-facets'
import { contactName, groupName, previewLine } from '@/lib/format'
import { byContactId, summariesFor } from '@/lib/usage'
import { cn } from '@/lib/utils'
import type { Contact, Group, PersonaBackend, PersonaTemplate } from '@/types'

/**
 * Every row's preview, timestamp and cost come from the `messages` and
 * `usage_events` rows a turn actually writes.
 *
 * A group's figures are its members' summed, since a group has no session of
 * its own — it is a merged view and a router.
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
 * thing a group is for: it is a merged view and a router, not a session of its
 * own.
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
            src={botttsDataUri(persona.avatarSeed, persona.avatarColor)}
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

/**
 * A group row plus its right-click menu and that menu's dialogs.
 *
 * The same shape as `ContactRow` above and for the same reason: each row needs
 * its own dialog state, and the items are the ones the group thread header's ⋯
 * menu renders, so right-clicking a group offers exactly what opening it would.
 */
function GroupRow({
  group,
  ...item
}: Omit<React.ComponentProps<typeof ConversationListItem>, 'repoPath' | 'contextMenu'> & {
  group: Group
}): React.JSX.Element {
  const [dialog, setDialog] = useState<GroupDialogKind | null>(null)

  return (
    <>
      <ConversationListItem
        {...item}
        repoPath={group.repoPath}
        contextMenu={
          <ContextMenuContent>
            <GroupActionItems kind="context" group={group} onOpen={setDialog} />
          </ContextMenuContent>
        }
      />
      <GroupActionDialogs group={group} open={dialog} onClose={() => setDialog(null)} />
    </>
  )
}

export function ConversationList({ filter }: { filter: ListFilter }): React.JSX.Element {
  const selected = useUiStore((state) => state.selectedConversation)
  const setSelected = useUiStore((state) => state.setSelectedConversation)
  const setDialog = useUiStore((state) => state.setDialog)
  const { data: contacts = [], isPending, isError } = useContacts()
  const { data: groups = [] } = useGroups()
  const { data: personaTemplates = [] } = usePersonas()
  const { data: previews = [] } = useMessagePreviews()
  const { data: groupPreviews = [] } = useGroupMessagePreviews()
  const { data: usageSummaries = [] } = useUsageSummaries()
  const { data: runs = [] } = useActiveRuns()
  const unread = useUnread()
  const filtering = isFiltering(filter)
  // Revealed by the disclosure at the foot of the list, and deliberately not
  // persisted: hiding is the setting, showing is a peek.
  const [showHidden, setShowHidden] = useState(false)

  const previewFor = useMemo(
    () => (contactId: string) => previews.find((message) => message.contactId === contactId),
    [previews]
  )

  /**
   * Spend per conversation, from the SQL rollup rather than from raw events
   *.
   *
   * This used to call `usage.list` with no argument — every usage row ever
   * written — and then scan that array once per contact and once per group. The
   * rail's cost of drawing therefore grew with the number of turns the whole
   * fleet had ever taken, which is invisible at three contacts and is the first
   * thing to go at thirty.
   *
   * The undefined-not-zero rule is unchanged and now lives in `summariesFor`: a
   * contact with no rollup entry has never run a turn, and its badge should be
   * absent rather than read "$0.00", which claims a turn was free.
   */
  const summaryIndex = useMemo(() => byContactId(usageSummaries), [usageSummaries])
  const usageFor = useMemo(
    () => (contactId: string) => summariesFor(summaryIndex, [contactId]),
    [summaryIndex]
  )

  const personaFor = useMemo(
    () =>
      (id: string): PersonaTemplate | undefined =>
        personaTemplates.find((persona) => persona.id === id),
    [personaTemplates]
  )

  // Recency-sorted within each section: the services return
  // alphabetical, which suits a phone book, not a messages app. The preview —
  // already fetched for the row's own subtitle — is the timestamp authority.
  const visibleContacts = useMemo(
    () =>
      byRecency(
        filterList(
          contacts,
          filter,
          {
            [FACET_REPO]: (contact) => [contact.repoPath],
            [FACET_PERSONA]: (contact) => [contact.personaTemplateId],
            [FACET_STATE]: (contact) =>
              (unread.get(`contact:${contact.id}`) ?? 0) > 0 ? [STATE_UNREAD] : []
          },
          (contact) => ({
            // What the row shows, so the searchable text and the
            // visible text finally agree.
            label: contactName(contact, personaFor(contact.personaTemplateId)),
            detail: contact.repoPath
          })
        ),
        (contact) => previews.find((message) => message.contactId === contact.id)?.timestamp,
        (contact) => contact.displayName
      ),
    [contacts, filter, previews, unread, personaFor]
  )

  /**
   * Hidden groups, for the disclosure at the foot of the list.
   *
   * Its own list rather than a length difference, so the count stays right
   * while a filter is narrowing everything else.
   */
  const hiddenGroups = useMemo(() => groups.filter((group) => group.hidden), [groups])

  const visibleGroups = useMemo(
    () =>
      byRecency(
        filterList(
          /**
           * A **search** reaches hidden groups whether or not they are
           * revealed. Hiding governs the *resting* state of the list; if
           * someone types the name of a group they hid, answering "nothing
           * matches" is both wrong and the thing that would make hiding feel
           * like deletion.
           *
           * A **facet** does not, and the distinction is deliberate. Typing a
           * name is asking for one thing you already have in mind; ticking
           * "checkout-service" is narrowing a list, and a hidden row
           * reappearing because you narrowed would undo the hiding without
           * being asked. So this keys off `hasQuery` rather than `isFiltering`.
           */
          groups.filter((group) => !group.hidden || showHidden || hasQuery(filter)),
          filter,
          {
            [FACET_REPO]: (group) => [group.repoPath],
            // A group is a view of the contacts on a repository, so it belongs
            // to every persona working there — otherwise filtering by persona
            // would hide the shared thread that persona posts into.
            [FACET_PERSONA]: (group) =>
              contacts
                .filter((contact) => contact.repoPath === group.repoPath)
                .map((contact) => contact.personaTemplateId),
            [FACET_STATE]: (group) =>
              (unread.get(`group:${group.id}`) ?? 0) > 0 ? [STATE_UNREAD] : []
          },
          // The name as well as the path, now that a group can carry one of its
          // own — searching for what is written on the row and getting nothing
          // back was the alternative.
          (group) => ({ label: groupName(group), detail: group.repoPath })
        ),
        (group) => groupPreviews.find((message) => message.groupId === group.id)?.timestamp,
        (group) => groupName(group)
      ),
    [groups, filter, groupPreviews, showHidden, contacts, unread]
  )

  /**
   * ⌥↑ / ⌥↓ walk the rows above, in the order they are rendered.
   *
   * Bound here rather than in `AppShell` because this is where that order
   * exists. Recomputing it up there from the same queries would be a second
   * ordering to keep in step with this one, and the symptom of drift would be a
   * shortcut that skips a row the user is looking straight at.
   *
   * ⌥ rather than ⌘: on macOS ⌘↑/⌘↓ move the caret to the start and end of a
   * text field, and the composer holds focus for most of the time anyone
   * spends reading a thread. Taking a standard editing key away from a text box
   * to save a modifier is a bad trade. ⌥↑/⌥↓ are Slack's channel keys and are
   * effectively free in a short chat composer.
   *
   * Not bound while a modal is open: the palette drives its own list with the
   * arrow keys, and a background listener would move the selection underneath
   * the user while they are choosing something else.
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) return
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
      if (useUiStore.getState().dialog !== null) return

      event.preventDefault()
      const order: ConversationRef[] = [
        ...visibleContacts.map((contact) => ({ kind: 'contact' as const, id: contact.id })),
        ...visibleGroups.map((group) => ({ kind: 'group' as const, id: group.id }))
      ]
      // Selection read through the store rather than from the closure, so this
      // effect re-binds when the order changes and not on every navigation.
      const next = stepConversation(
        order,
        useUiStore.getState().selectedConversation,
        event.key === 'ArrowDown' ? 1 : -1
      )
      if (next) setSelected(next)
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [visibleContacts, visibleGroups, setSelected])

  if (isPending) {
    return <EmptyState compact loading title="Loading conversations…" />
  }

  // Ahead of both nothings below, because a failed read is a third state and
  // the other two would lie about it: "no conversations yet" is advice to create
  // something, offered in answer to a question the app could not ask.
  if (isError) {
    return (
      <EmptyState
        compact
        error
        title="Couldn’t load conversations"
        description="The app could not read from its own database. Reopening the window usually clears it."
      />
    )
  }

  if (visibleContacts.length === 0 && visibleGroups.length === 0) {
    return filtering ? (
      <EmptyState
        compact
        icon={MessagesSquare}
        title="Nothing matches"
        description={noMatchDescription(filter)}
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
            // The Contact's own name, not the persona's — three
            // contacts on three repos were three rows all called "Code
            // Reviewer". The avatar below still carries the persona.
            name={contactName(contact, persona)}
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
                seed={persona?.avatarSeed}
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
        // A group's figure is its members' summed — the same composition the
        // usage rail does for a persona, through the same helper.
        const memberUsage = summariesFor(summaryIndex, memberIds)
        // The group's own log, not its members' 1:1 threads — a group row
        // should preview what happened *in the group*, which means session
        // summaries, mentions, and routed replies.
        const latest = groupPreviews.find((message) => message.groupId === group.id)

        return (
          <GroupRow
            key={group.id}
            group={group}
            name={groupName(group)}
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

      {/*
        The way back from hiding. A count rather than a permanent "Hidden"
        section: the row exists to be found once, not to reinstate the clutter
        hiding was meant to remove. Absent entirely when nothing is hidden, and
        while a filter is active — a hidden group that matches the search is
        already shown, so the count would be describing a different list.
      */}
      {!hasQuery(filter) && hiddenGroups.length > 0 && (
        <button
          type="button"
          onClick={() => setShowHidden((current) => !current)}
          className="text-muted-foreground hover:text-foreground self-start px-2 py-1 text-left text-meta transition-colors"
        >
          {showHidden
            ? 'Hide them again'
            : `${hiddenGroups.length} hidden ${hiddenGroups.length === 1 ? 'group' : 'groups'}`}
        </button>
      )}
    </div>
  )
}
