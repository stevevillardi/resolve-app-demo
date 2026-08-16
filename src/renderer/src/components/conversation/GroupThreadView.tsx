import { Fragment, useMemo, useState } from 'react'
import { AtSign, Users } from 'lucide-react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { AvatarColorSwatch } from '@/components/common/AvatarColorSwatch'
import { EmptyState } from '@/components/common/EmptyState'
import { ThreadHeader } from './ThreadHeader'
import { DaySeparator } from './DaySeparator'
import { MessageBubble } from './MessageBubble'
import { JournalNotice } from './JournalNotice'
import { RoutineRunNotice } from './RoutineRunNotice'
import { MentionPicker } from './MentionPicker'
import { Composer } from './Composer'
import { isSameDay, repoName } from '@/lib/format'
import { contacts, groupMessages, groups, personaTemplates } from '@/mocks'
import type { Contact, GroupMessage, PersonaTemplate } from '@/types'

interface GroupThreadViewProps {
  groupId: string
}

function personaFor(personaTemplateId: string): PersonaTemplate | undefined {
  return personaTemplates.find((persona) => persona.id === personaTemplateId)
}

function contactFor(contactId: string | undefined): Contact | undefined {
  return contacts.find((contact) => contact.id === contactId)
}

/**
 * The four GroupMessage types are told apart by *shape*, not hue:
 *
 *   agent_reply    → an inbound bubble with a sender header (the only bubble
 *                    an agent produces here)
 *   user_mention   → an outbound bubble — it is literally the user's own
 *                    message, so rendering it as anything else was wrong
 *   system_summary → a centred hairline record (JournalNotice)
 *   routine_run    → a timeline log row (RoutineRunNotice)
 *
 * Greyscale the screenshot and all four are still distinguishable. That is the
 * test the previous four-tinted-boxes version failed.
 */
function GroupEntry({ message }: { message: GroupMessage }): React.JSX.Element {
  const author = contactFor(message.contactId)
  const authorPersona = author ? personaFor(author.personaTemplateId) : undefined

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
          backend={authorPersona?.backend}
        />
      )
  }
}

export function GroupThreadView({ groupId }: GroupThreadViewProps): React.JSX.Element {
  const [draft, setDraft] = useState('')
  const group = useMemo(() => groups.find((g) => g.id === groupId), [groupId])
  const thread = useMemo(
    () =>
      groupMessages.filter((m) => m.groupId === groupId).sort((a, b) => a.timestamp - b.timestamp),
    [groupId]
  )
  const repoContacts = useMemo(
    () => contacts.filter((contact) => contact.repoPath === group?.repoPath),
    [group]
  )

  if (!group) {
    return <EmptyState icon={Users} title="Group not found" />
  }

  const name = repoName(group.repoPath)

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
                const persona = personaFor(contact.personaTemplateId)
                return (
                  <AvatarColorSwatch
                    key={contact.id}
                    name={persona?.name ?? contact.displayName}
                    color={persona?.avatarColor ?? 'var(--muted)'}
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
        <div className="mx-auto flex max-w-4xl flex-col gap-3 px-4 py-4">
          {thread.length === 0 ? (
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
                  <GroupEntry message={message} />
                </Fragment>
              )
            })
          )}
        </div>
      </ScrollArea>

      <Composer
        placeholder={`Message the ${name} group…`}
        value={draft}
        onValueChange={setDraft}
        onSend={() => setDraft('')}
        hint={<span>Mention a persona with @ to route this to its own session.</span>}
        leadingAction={
          <MentionPicker
            contacts={repoContacts}
            personaTemplates={personaTemplates}
            onSelect={(contact) => {
              const persona = personaFor(contact.personaTemplateId)
              setDraft((prev) => `${prev}@${persona?.name ?? contact.displayName} `)
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
