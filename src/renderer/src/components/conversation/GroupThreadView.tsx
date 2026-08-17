import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { AtSign, Users } from 'lucide-react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { AvatarColorSwatch } from '@/components/common/AvatarColorSwatch'
import { EmptyState } from '@/components/common/EmptyState'
import { ThreadHeader } from './ThreadHeader'
import { DaySeparator } from './DaySeparator'
import { UnreadSeparator } from './UnreadSeparator'
import { MessageBubble } from './MessageBubble'
import { JournalNotice } from './JournalNotice'
import { BranchRequestNotice } from './BranchRequestNotice'
import { RoutineRunNotice } from './RoutineRunNotice'
import { MentionPicker } from './MentionPicker'
import { Composer } from './Composer'
import { isSameDay, repoName } from '@/lib/format'
import { mentionToken, parseMention } from '@/lib/mention'
import { streamText } from '@/lib/stream'
import { useContacts, useGroups } from '@/hooks/useConversations'
import { usePersonas } from '@/hooks/usePersonas'
import { useAgentStreams, useGroupMessages, useMentionInGroup } from '@/hooks/useGroupMessages'
import { useCancelRun } from '@/hooks/useMessages'
import { useMarkRead } from '@/hooks/useUnread'
import { firstUnreadIndex } from '@/lib/unread'
import { useRunStore } from '@/store/useRunStore'
import { draftKey, useDraftStore } from '@/store/useDraftStore'
import { useUiStore } from '@/store/useUiStore'
import type { Contact, GroupMessage, PersonaTemplate } from '@/types'

interface GroupThreadViewProps {
  groupId: string
}

/**
 * The GroupMessage types are told apart by *shape*, not hue:
 *
 *   agent_reply    → an inbound bubble with a sender header (the only bubble
 *                    an agent produces here)
 *   user_mention   → an outbound bubble — it is literally the user's own
 *                    message, so rendering it as anything else was wrong
 *   system_summary → a centred hairline record (JournalNotice)
 *   routine_run    → a timeline log row (RoutineRunNotice)
 *   branch_request → the same log rhythm but a heavier rule and a control, the
 *                    only row here that asks the user for something
 *
 * Greyscale the screenshot and they are all still distinguishable. That is the
 * test the previous four-tinted-boxes version failed.
 */
function GroupEntry({
  message,
  personaFor,
  onReviewBranch
}: {
  message: GroupMessage
  personaFor: (contactId: string | undefined) => PersonaTemplate | undefined
  onReviewBranch?: (branch: string) => void
}): React.JSX.Element {
  const authorPersona = personaFor(message.contactId)

  switch (message.type) {
    case 'system_summary':
      return (
        <JournalNotice
          content={message.content}
          category={message.category}
          durable={message.durable}
          authorName={authorPersona?.name}
          timestamp={message.timestamp}
        />
      )
    case 'routine_run':
      return (
        <RoutineRunNotice
          content={message.content}
          authorName={authorPersona?.name}
          timestamp={message.timestamp}
        />
      )
    case 'branch_request':
      return (
        <BranchRequestNotice
          content={message.content}
          branch={message.branch ?? ''}
          authorName={authorPersona?.name}
          timestamp={message.timestamp}
          {...(message.resolvedAt !== undefined ? { resolvedAt: message.resolvedAt } : {})}
          onReview={onReviewBranch}
        />
      )
    case 'user_mention':
      return <MessageBubble role="user" content={message.content} timestamp={message.timestamp} />
    case 'agent_reply':
    default:
      return (
        <MessageBubble
          role="assistant"
          content={message.content}
          timestamp={message.timestamp}
          senderName={authorPersona?.name}
          senderColor={authorPersona?.avatarColor}
          senderSeed={authorPersona?.id}
          backend={authorPersona?.backend}
        />
      )
  }
}

export function GroupThreadView({ groupId }: GroupThreadViewProps): React.JSX.Element {
  const draftId = draftKey('group', groupId)
  const draft = useDraftStore((state) => state.byConversation[draftId] ?? '')
  const setDraftValue = useDraftStore((state) => state.setDraft)
  const clearDraft = useDraftStore((state) => state.clearDraft)
  const setDraft = (value: string): void => setDraftValue(draftId, value)

  const { data: groups = [], isLoading: groupsLoading } = useGroups()
  const { data: contacts = [] } = useContacts()
  const { data: personaTemplates = [] } = usePersonas()
  const { data: thread = [], isLoading: threadLoading } = useGroupMessages(groupId)

  const group = useMemo(() => groups.find((g) => g.id === groupId), [groups, groupId])
  const repoContacts = useMemo(
    () => contacts.filter((contact) => contact.repoPath === group?.repoPath),
    [contacts, group]
  )

  const personaById = useMemo(
    () => new Map(personaTemplates.map((persona) => [persona.id, persona])),
    [personaTemplates]
  )
  const contactById = useMemo(() => new Map(contacts.map((c) => [c.id, c])), [contacts])
  const personaFor = useMemo(
    () =>
      (contactId: string | undefined): PersonaTemplate | undefined => {
        const contact = contactId ? contactById.get(contactId) : undefined
        return contact ? personaById.get(contact.personaTemplateId) : undefined
      },
    [contactById, personaById]
  )
  const personaOf = (contact: Contact): PersonaTemplate | undefined =>
    personaById.get(contact.personaTemplateId)

  // Every member, not just the mentioned one: a reply can arrive here from any
  // contact on this repo — an @mention started here, or a 1:1 turn elsewhere
  // whose summary posts to this group.
  const memberIds = useMemo(() => repoContacts.map((contact) => contact.id), [repoContacts])
  useAgentStreams(memberIds)

  const runsByContact = useRunStore((state) => state.byContact)
  const { mention, error: mentionError, reset } = useMentionInGroup(groupId)

  // A branch request is the one row here that asks the user for something, and
  // the Branches panel is where the answer lives — so the button navigates
  // rather than trying to inline a merge into the thread.
  const setSection = useUiStore((state) => state.setSection)
  const setSelectedBranch = useUiStore((state) => state.setSelectedBranch)
  const reviewBranch = (branch: string): void => {
    if (!group) return
    setSelectedBranch({ repoPath: group.repoPath, branch })
    setSection('branches')
  }
  const { cancel } = useCancelRun()

  // The one member currently mid-turn, if any. Single-target mentions mean at
  // most one *from here*, but a sibling 1:1 turn can also be in flight, and the
  // thread should show it streaming rather than appearing from nowhere on done.
  const live = useMemo(
    () =>
      memberIds
        .map((id) => ({ contactId: id, turn: runsByContact[id] }))
        .find((entry) => entry.turn && !entry.turn.stream.finished),
    [memberIds, runsByContact]
  )

  const contentRef = useRef<HTMLDivElement>(null)
  const streamed = live?.turn ? streamText(live.turn.stream) : ''

  // Same boundary-at-open capture and read-on-open/arrival contract as
  // ThreadView — see the comments there.
  const [boundary, setBoundary] = useState<{ id: string; at: number | null } | null>(null)
  if (group && boundary?.id !== groupId) {
    setBoundary({ id: groupId, at: group.lastReadAt })
  }
  const unreadIndex = firstUnreadIndex(thread, boundary?.id === groupId ? boundary.at : null)

  const { markGroupRead } = useMarkRead()
  const lastMessageAt = thread.length > 0 ? thread[thread.length - 1].timestamp : null
  const groupLoaded = group !== undefined
  useEffect(() => {
    if (!groupLoaded) return
    markGroupRead(groupId)
  }, [groupId, groupLoaded, lastMessageAt, markGroupRead])

  useEffect(() => {
    // Base UI's ScrollArea does not forward a ref to its viewport, so the
    // scrollable element has to be found from a child. Same workaround as
    // ThreadView.
    const viewport = contentRef.current?.closest('[data-slot="scroll-area-viewport"]')
    if (viewport) viewport.scrollTop = viewport.scrollHeight
  }, [thread.length, streamed])

  if (groupsLoading) {
    return <EmptyState icon={Users} title="Loading…" loading />
  }

  if (!group) {
    return <EmptyState icon={Users} title="Group not found" />
  }

  const name = repoName(group.repoPath)

  const mentionTargets = repoContacts.map((contact) => ({
    contactId: contact.id,
    name: personaOf(contact)?.name ?? contact.displayName
  }))

  const parsed = parseMention(draft, mentionTargets)
  const isRunning = Boolean(live)

  const handleSend = (): void => {
    if (!parsed) return
    reset()
    // Cleared only on acceptance — same contract as ThreadView's send.
    mention(parsed.contactId, parsed.content, { onSuccess: () => clearDraft(draftId) })
  }

  return (
    <div className="bg-background flex h-full min-h-0 flex-col">
      <ThreadHeader
        leading={
          <span className="border-border flex size-6 shrink-0 items-center justify-center rounded-md border">
            <Users className="text-muted-foreground size-3.5" />
          </span>
        }
        title={name}
        subtitle={group.repoPath}
        actions={
          <div className="flex items-center gap-1.5">
            {/* Spaced, not overlapped — at this size an overlap clips the
                initials off the avatars behind, which is the whole payload. */}
            <span className="flex gap-1">
              {repoContacts.map((contact) => {
                const persona = personaOf(contact)
                return (
                  <AvatarColorSwatch
                    key={contact.id}
                    name={persona?.name ?? contact.displayName}
                    color={persona?.avatarColor ?? 'var(--muted)'}
                    seed={persona?.id}
                    size="xs"
                  />
                )
              })}
            </span>
            <span className="text-muted-foreground text-xs">
              {repoContacts.length} {repoContacts.length === 1 ? 'persona' : 'personas'}
            </span>
          </div>
        }
      />

      <ScrollArea className="min-h-0 flex-1">
        <div ref={contentRef} className="mx-auto flex max-w-4xl flex-col gap-3 px-4 py-4">
          {threadLoading ? (
            <EmptyState icon={Users} title="Loading…" loading compact />
          ) : thread.length === 0 && !live ? (
            <EmptyState
              icon={Users}
              title="Nothing here yet"
              description="Session summaries, routine runs, and @mentions for this repo land here."
            />
          ) : (
            thread.map((message, index) => {
              const previous = thread[index - 1]
              const newDay = !previous || !isSameDay(previous.timestamp, message.timestamp)
              return (
                <Fragment key={message.id}>
                  {newDay && <DaySeparator timestamp={message.timestamp} />}
                  {index === unreadIndex && <UnreadSeparator />}
                  <GroupEntry
                    message={message}
                    personaFor={personaFor}
                    onReviewBranch={reviewBranch}
                  />
                </Fragment>
              )
            })
          )}

          {/* The routed reply, before it is persisted. Rendered from the same
              contact-keyed store the 1:1 thread reads, which is what keeps the
              two views of this exchange identical rather than merely similar. */}
          {live?.turn && !live.turn.stream.error && (
            <MessageBubble
              role="assistant"
              content={streamed}
              status="streaming"
              activity={live.turn.stream.activity}
              toolCalls={live.turn.stream.toolCalls}
              senderName={personaFor(live.contactId)?.name}
              senderColor={personaFor(live.contactId)?.avatarColor}
              senderSeed={personaFor(live.contactId)?.id}
              backend={personaFor(live.contactId)?.backend}
            />
          )}
          {live?.turn?.stream.error && (
            <MessageBubble
              role="assistant"
              content={streamed}
              status="error"
              error={live.turn.stream.error}
              senderName={personaFor(live.contactId)?.name}
              senderColor={personaFor(live.contactId)?.avatarColor}
              senderSeed={personaFor(live.contactId)?.id}
            />
          )}
        </div>
      </ScrollArea>

      <Composer
        placeholder={`Message the ${name} group…`}
        value={draft}
        onValueChange={setDraft}
        onSend={handleSend}
        busy={isRunning}
        onStop={() => live?.turn && cancel(live.turn.runId)}
        // A draft addressed to nobody has nowhere to go: the Group has no
        // session of its own (§4), so an unaddressed message is not a message
        // this thread can send.
        disabled={!parsed}
        hint={<span>Mention a persona with @ to route this to its own session.</span>}
        notice={
          mentionError ?? (draft.trim() && !parsed ? 'Start with @ to choose who answers.' : null)
        }
        leadingAction={
          <MentionPicker
            contacts={repoContacts}
            personaTemplates={personaTemplates}
            onSelect={(contact) => {
              const persona = personaOf(contact)
              setDraft(`${draft}${mentionToken(persona?.name ?? contact.displayName)}`)
            }}
            trigger={
              <Button variant="ghost" size="icon-sm" aria-label="Mention a persona">
                <AtSign className="size-4" />
              </Button>
            }
          />
        }
      />
    </div>
  )
}
