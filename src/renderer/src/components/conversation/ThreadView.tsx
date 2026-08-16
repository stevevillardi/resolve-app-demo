import { useMemo } from 'react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { AvatarColorSwatch } from '@/components/common/AvatarColorSwatch'
import { EmptyState } from '@/components/common/EmptyState'
import { UsageBadge } from '@/components/usage/UsageBadge'
import { OpenPRButton } from '@/components/github/OpenPRButton'
import { MessageBubble } from './MessageBubble'
import { Composer } from './Composer'
import { usageForContact } from '@/lib/usage'
import { contacts, messages, personaTemplates, usageEvents } from '@/mocks'
import { MessageSquare } from 'lucide-react'

interface ThreadViewProps {
  contactId: string
}

export function ThreadView({ contactId }: ThreadViewProps): React.JSX.Element {
  const contact = useMemo(() => contacts.find((c) => c.id === contactId), [contactId])
  const persona = useMemo(
    () => personaTemplates.find((p) => p.id === contact?.personaTemplateId),
    [contact]
  )
  const thread = useMemo(() => messages.filter((m) => m.contactId === contactId), [contactId])
  const usage = useMemo(() => usageForContact(usageEvents, contactId), [contactId])

  if (!contact || !persona) {
    return <EmptyState icon={MessageSquare} title="Conversation not found" />
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-border flex items-center gap-2.5 border-b px-4 py-3">
        <AvatarColorSwatch name={contact.displayName} color={persona.avatarColor} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{contact.displayName}</p>
          <p className="text-muted-foreground truncate text-xs">{contact.repoPath}</p>
        </div>
        <Badge variant="outline" className="capitalize">
          {persona.backend}
        </Badge>
        <UsageBadge summary={usage} />
        <OpenPRButton githubScope={persona.githubScope} />
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-3 px-4 py-4">
          {thread.length === 0 ? (
            <EmptyState
              icon={MessageSquare}
              title="No messages yet"
              description="Say hello to get started."
            />
          ) : (
            thread.map((message) => (
              <MessageBubble
                key={message.id}
                role={message.role}
                content={message.content}
                status={message.status}
                error={message.error}
                backend={persona.backend}
              />
            ))
          )}
        </div>
      </ScrollArea>

      <Composer placeholder={`Message ${persona.name}…`} />
    </div>
  )
}
