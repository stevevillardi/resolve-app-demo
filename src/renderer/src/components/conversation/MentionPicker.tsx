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
import { ScopeChip } from '@/components/common/ScopeChip'
import type { Contact, PersonaTemplate } from '@/types'

interface MentionPickerProps {
  contacts: Contact[]
  personaTemplates: PersonaTemplate[]
  onSelect: (contact: Contact) => void
  trigger: React.ReactElement
}

// Single-select only. An @mention routes to exactly one contact's session;
// broadcasting one message to every persona in a repo is deliberately not a
// thing this app can do, because there would be no one thread that answered it.
// The roster is filtered to the group's repoPath — a persona bound elsewhere
// cannot be addressed from here.
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
      {/* `render`, not children — wrapping a <Button> in the default trigger
          nests a button inside a button. */}
      <PopoverTrigger render={trigger} />
      <PopoverContent align="start" side="top" className="w-72 p-0">
        <Command>
          <CommandInput placeholder="Mention a persona…" />
          <CommandList>
            <CommandEmpty>No personas bound to this repo.</CommandEmpty>
            <CommandGroup>
              {contacts.map((contact) => {
                const persona = personaFor(contact.personaTemplateId)
                return (
                  <CommandItem
                    key={contact.id}
                    value={persona?.name ?? contact.displayName}
                    onSelect={() => {
                      onSelect(contact)
                      setOpen(false)
                    }}
                    className="gap-2"
                  >
                    <AvatarColorSwatch
                      name={persona?.name ?? contact.displayName}
                      color={persona?.avatarColor ?? 'var(--muted)'}
                      seed={persona?.avatarSeed}
                      size="sm"
                    />
                    <span className="min-w-0 flex-1 truncate">
                      {persona?.name ?? contact.displayName}
                    </span>
                    {/* Which persona you route to decides what can happen to
                        the repo, so scope is part of the choice. */}
                    {persona && <ScopeChip axis="sandbox" value={persona.sandbox} compact />}
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
