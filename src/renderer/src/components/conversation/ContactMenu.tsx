import { useState } from 'react'
import { MoreHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { ContactActionDialogs, ContactActionItems, type ContactDialogKind } from './ContactActions'
import type { Contact, PersonaBackend } from '@/types'

/**
 * Rename and delete for the selected Contact.
 *
 * There was no way to do either: `contacts.delete` had existed in main since
 * Phase 12, with worktree cleanup and a two-step refusal, and nothing in the
 * renderer ever called it. Renaming was not possible at all.
 *
 * Header menu, and since Phase 17 also the conversation row's right-click —
 * both render ContactActionItems, so they cannot drift. The items and dialogs
 * live in ContactActions.tsx; this file is just the ⋯ button.
 */
export function ContactMenu({
  contact,
  backend
}: {
  contact: Contact
  backend: PersonaBackend
}): React.JSX.Element {
  const [dialog, setDialog] = useState<ContactDialogKind | null>(null)

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="ghost" size="icon-sm" aria-label={`Manage ${contact.displayName}`}>
              <MoreHorizontal className="size-4" />
            </Button>
          }
        />
        <DropdownMenuContent align="end" className="w-52">
          <ContactActionItems kind="dropdown" onOpen={setDialog} />
        </DropdownMenuContent>
      </DropdownMenu>

      <ContactActionDialogs
        contact={contact}
        backend={backend}
        open={dialog}
        onClose={() => setDialog(null)}
      />
    </>
  )
}
