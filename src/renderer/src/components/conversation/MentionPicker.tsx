import { useState } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList
} from '@/components/ui/command'
import { AvatarColorSwatch } from '@/components/common/AvatarColorSwatch'
import type { Contact, PersonaTemplate } from '@/types'

interface MentionPickerProps {
  contacts: Contact[]
  personaTemplates: PersonaTemplate[]
  onSelect: (contact: Contact) => void
  trigger: React.ReactNode
}

// Single-select only — v1 explicitly forbids @mention broadcast to multiple
// contacts at once (blueprint §10 / docs/plan/07-group-coordination.md).
// Real filtering by the group's repoPath lands in Phase 7; this filters the
// mock list the same way so the prop shape doesn't change later.
export function MentionPicker({
  contacts,
  personaTemplates,
  onSelect,
  trigger
}: MentionPickerProps): React.JSX.Element {
  const [open, setOpen] = useState(false)

  const personaFor = (personaTemplateId: string): PersonaTemplate | undefined =>
    personaTemplates.find((persona) => persona.id === personaTemplateId)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger>{trigger}</PopoverTrigger>
      <PopoverContent align="start" side="top" className="w-64 p-0">
        <Command>
          <CommandInput placeholder="Mention a contact…" />
          <CommandList>
            <CommandEmpty>No contacts in this repo.</CommandEmpty>
            <CommandGroup>
              {contacts.map((contact) => {
                const persona = personaFor(contact.personaTemplateId)
                return (
                  <CommandItem
                    key={contact.id}
                    value={contact.displayName}
                    onSelect={() => {
                      onSelect(contact)
                      setOpen(false)
                    }}
                  >
                    <AvatarColorSwatch
                      name={contact.displayName}
                      color={persona?.avatarColor ?? 'var(--accent-contact)'}
                      size="sm"
                    />
                    {contact.displayName}
                  </CommandItem>
                )
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
