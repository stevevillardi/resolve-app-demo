import { Fragment, useMemo } from 'react'
import { MessageSquare } from 'lucide-react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { AvatarColorSwatch } from '@/components/common/AvatarColorSwatch'
import { BackendBadge } from '@/components/common/BackendBadge'
import { ScopeChip } from '@/components/common/ScopeChip'
import { EmptyState } from '@/components/common/EmptyState'
import { UsageBadge } from '@/components/usage/UsageBadge'
import { OpenPRButton } from '@/components/github/OpenPRButton'
import { ThreadHeader } from './ThreadHeader'
import { DaySeparator } from './DaySeparator'
import { MessageBubble } from './MessageBubble'
import { Composer } from './Composer'
import { usageForContact } from '@/lib/usage'
import { isSameDay } from '@/lib/format'
import { contacts, messages, personaTemplates, usageEvents } from '@/mocks'

interface ThreadViewProps {
  contactId: string
}

export function ThreadView({ contactId }: ThreadViewProps): React.JSX.Element {
  const contact = useMemo(() => contacts.find((c) => c.id === contactId), [contactId])
  const persona = useMemo(
    () => personaTemplates.find((p) => p.id === contact?.personaTemplateId),
    [contact]
  )
  const thread = useMemo(
    () =>
      messages.filter((m) => m.contactId === contactId).sort((a, b) => a.timestamp - b.timestamp),
    [contactId]
  )
  const usage = useMemo(() => usageForContact(usageEvents, contactId), [contactId])

  if (!contact || !persona) {
    return <EmptyState icon={MessageSquare} title="Conversation not found" />
  }

  return (
    <div className="bg-background flex h-full min-h-0 flex-col">
      <ThreadHeader
        leading={<AvatarColorSwatch name={persona.name} color={persona.avatarColor} size="sm" />}
        title={persona.name}
        subtitle={contact.repoPath}
        actions={
          <>
            <BackendBadge backend={persona.backend} />
            <UsageBadge summary={usage} />
            <OpenPRButton githubScope={persona.githubScope} />
          </>
        }
      />

      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto flex max-w-4xl flex-col gap-3 px-4 py-4">
          {thread.length === 0 ? (
            <EmptyState
              icon={MessageSquare}
              title="No messages yet"
              description={`Ask ${persona.name} something about ${contact.repoPath}.`}
            />
          ) : (
            thread.map((message, index) => {
              const previous = thread[index - 1]
              const newDay = !previous || !isSameDay(previous.timestamp, message.timestamp)
              return (
                <Fragment key={message.id}>
                  {newDay && <DaySeparator timestamp={message.timestamp} />}
                  <MessageBubble
                    role={message.role}
                    content={message.content}
                    timestamp={message.timestamp}
                    status={message.status}
                    error={message.error}
                    backend={persona.backend}
                  />
                </Fragment>
              )
            })
          )}
        </div>
      </ScrollArea>

      <Composer
        placeholder={`Message ${persona.name}…`}
        hint={
          // Scope lives beside the send button rather than buried in the
          // header: what this persona is allowed to do is exactly what you
          // want to know at the moment you hand it work.
          <>
            <span>Runs as</span>
            <span className="text-foreground font-medium">{persona.name}</span>
            <ScopeChip axis="sandbox" value={persona.sandbox} />
            <ScopeChip axis="github" value={persona.githubScope} />
          </>
        }
      />
    </div>
  )
}
