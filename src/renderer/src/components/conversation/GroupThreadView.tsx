import { useMemo, useState } from 'react'
import { AtSign, Users } from 'lucide-react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/common/EmptyState'
import { MessageBubble } from './MessageBubble'
import { JournalNotice } from './JournalNotice'
import { RoutineRunNotice } from './RoutineRunNotice'
import { MentionPicker } from './MentionPicker'
import { Composer } from './Composer'
import { contacts, groupMessages, groups, personaTemplates } from '@/mocks'
import type { Contact, PersonaTemplate } from '@/types'

interface GroupThreadViewProps {
  groupId: string
}

function personaFor(personaTemplateId: string): PersonaTemplate | undefined {
  return personaTemplates.find((persona) => persona.id === personaTemplateId)
}

function contactFor(contactId: string | undefined): Contact | undefined {
  return contacts.find((contact) => contact.id === contactId)
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

  const repoName = group.repoPath.split('/').pop() ?? group.repoPath

  return (
    <div className="flex h-full flex-col">
      <div className="border-border flex items-center gap-2.5 border-b px-4 py-3">
        <span
          className="flex size-8 shrink-0 items-center justify-center rounded-full text-white"
          style={{ backgroundColor: 'var(--accent-group)' }}
        >
          <Users className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{repoName}</p>
          <p className="text-muted-foreground truncate text-xs">{group.repoPath}</p>
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-3 px-4 py-4">
          {thread.length === 0 ? (
            <EmptyState
              icon={Users}
              title="Nothing here yet"
              description="Contact summaries and @mentions will show up here."
            />
          ) : (
            thread.map((message) => {
              const author = contactFor(message.contactId)
              const authorPersona = author ? personaFor(author.personaTemplateId) : undefined

              switch (message.type) {
                case 'system_summary':
                  return (
                    <JournalNotice
                      key={message.id}
                      content={message.content}
                      category={message.category}
                      durable={message.durable}
                      authorName={author?.displayName}
                    />
                  )
                case 'routine_run':
                  return (
                    <RoutineRunNotice
                      key={message.id}
                      content={message.content}
                      authorName={author?.displayName}
                    />
                  )
                case 'user_mention':
                  return (
                    <div
                      key={message.id}
                      className="rounded-lg border-l-[3px] border px-3.5 py-2.5 text-sm"
                      style={{
                        backgroundColor: 'var(--notice-mention-bg)',
                        color: 'var(--notice-mention-fg)',
                        borderColor: 'var(--notice-mention-border)',
                        borderLeftColor: 'var(--notice-mention-rail)'
                      }}
                    >
                      {message.content}
                    </div>
                  )
                case 'agent_reply':
                default:
                  return (
                    <MessageBubble
                      key={message.id}
                      role="assistant"
                      content={message.content}
                      senderName={author?.displayName}
                      senderColor={authorPersona?.avatarColor}
                      backend={authorPersona?.backend}
                    />
                  )
              }
            })
          )}
        </div>
      </ScrollArea>

      <Composer
        placeholder={`Message the ${repoName} group…`}
        value={draft}
        onValueChange={setDraft}
        onSend={() => setDraft('')}
        leadingAction={
          <MentionPicker
            contacts={repoContacts}
            personaTemplates={personaTemplates}
            onSelect={(contact) => setDraft((prev) => `${prev}@${contact.displayName} `)}
            trigger={
              <Button variant="ghost" size="icon" aria-label="Mention a contact">
                <AtSign className="size-4" />
              </Button>
            }
          />
        }
      />
    </div>
  )
}
