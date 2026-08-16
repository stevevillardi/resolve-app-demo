import { ScrollArea } from '@/components/ui/scroll-area'
import { ConversationListItem } from './ConversationListItem'
import { useUiStore } from '@/store/useUiStore'
import { usageForContact } from '@/lib/usage'
import { contacts, groups, groupMessages, messages, personaTemplates, usageEvents } from '@/mocks'
import type { PersonaTemplate } from '@/types'

function personaFor(personaTemplateId: string): PersonaTemplate | undefined {
  return personaTemplates.find((persona) => persona.id === personaTemplateId)
}

function lastMessagePreview(contactId: string): string {
  const contactMessages = messages.filter((message) => message.contactId === contactId)
  const last = contactMessages[contactMessages.length - 1]
  if (!last) return 'No messages yet'
  if (last.status === 'error') return last.error?.message ?? 'Something went wrong'
  return last.content.split('\n')[0] ?? ''
}

function lastGroupMessagePreview(groupId: string): string {
  const groupMsgs = groupMessages.filter((message) => message.groupId === groupId)
  const last = groupMsgs[groupMsgs.length - 1]
  return last ? last.content.split('\n')[0] : 'No activity yet'
}

export function ConversationList(): React.JSX.Element {
  const selected = useUiStore((state) => state.selectedConversation)
  const setSelected = useUiStore((state) => state.setSelectedConversation)

  return (
    <ScrollArea className="h-full">
      <div className="flex flex-col py-1">
        <p className="text-muted-foreground px-3 pt-2 pb-1 text-xs font-semibold tracking-wide uppercase">
          Contacts
        </p>
        {contacts.map((contact) => {
          const persona = personaFor(contact.personaTemplateId)
          return (
            <ConversationListItem
              key={contact.id}
              kind="contact"
              name={contact.displayName}
              preview={lastMessagePreview(contact.id)}
              avatarColor={persona?.avatarColor}
              active={selected?.kind === 'contact' && selected.id === contact.id}
              usage={usageForContact(usageEvents, contact.id)}
              onSelect={() => setSelected({ kind: 'contact', id: contact.id })}
            />
          )
        })}
        <p className="text-muted-foreground px-3 pt-3 pb-1 text-xs font-semibold tracking-wide uppercase">
          Groups
        </p>
        {groups.map((group) => (
          <ConversationListItem
            key={group.id}
            kind="group"
            name={group.repoPath.split('/').pop() ?? group.repoPath}
            preview={lastGroupMessagePreview(group.id)}
            active={selected?.kind === 'group' && selected.id === group.id}
            onSelect={() => setSelected({ kind: 'group', id: group.id })}
          />
        ))}
      </div>
    </ScrollArea>
  )
}
