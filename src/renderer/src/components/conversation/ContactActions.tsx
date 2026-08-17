import { useState } from 'react'
import { Layers, Pencil, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu'
import { ContextMenuItem, ContextMenuSeparator } from '@/components/ui/context-menu'
import { ConfirmDeleteDialog } from '@/components/common/ConfirmDeleteDialog'
import { ContextPanel } from './ContextPanel'
import { Field } from '@/components/common/Field'
import { useDeleteContact, useRenameContact } from '@/hooks/useConversations'
import { useUiStore } from '@/store/useUiStore'
import type { Contact, PersonaBackend } from '@/types'

/**
 * The contact actions, shared between the thread header's ⋯ menu and the
 * conversation list's right-click menu (Phase 17).
 *
 * One source for the items and one for the dialogs, so the two menus cannot
 * offer different verbs for the same contact. The parent owns a single
 * `ContactDialogKind | null` and renders `<ContactActionDialogs>` beside
 * whichever menu it uses; everything stateful about the dialogs themselves
 * (draft name, refusal state) lives here.
 */

export type ContactDialogKind = 'context' | 'rename' | 'delete'

interface ContactActionItemsProps {
  /** Which menu family these items render into — they must match their popup. */
  kind: 'dropdown' | 'context'
  onOpen: (dialog: ContactDialogKind) => void
}

export function ContactActionItems({ kind, onOpen }: ContactActionItemsProps): React.JSX.Element {
  const Item = kind === 'dropdown' ? DropdownMenuItem : ContextMenuItem
  const Separator = kind === 'dropdown' ? DropdownMenuSeparator : ContextMenuSeparator

  return (
    <>
      <Item onClick={() => onOpen('context')}>
        <Layers />
        What it works with…
      </Item>
      <Item onClick={() => onOpen('rename')}>
        <Pencil />
        Rename…
      </Item>
      <Separator />
      <Item variant="destructive" onClick={() => onOpen('delete')}>
        <Trash2 />
        Delete contact…
      </Item>
    </>
  )
}

interface ContactActionDialogsProps {
  contact: Contact
  backend: PersonaBackend
  open: ContactDialogKind | null
  onClose: () => void
}

export function ContactActionDialogs({
  contact,
  backend,
  open,
  onClose
}: ContactActionDialogsProps): React.JSX.Element {
  return (
    <>
      {/* Mounted per opening, so each attempt starts clean — yesterday's
          refusal or half-typed name is unmounted state, not something to
          remember to reset. */}
      {open === 'rename' && <RenameContactDialog contact={contact} onClose={onClose} />}
      {open === 'delete' && <DeleteContactDialog contact={contact} onClose={onClose} />}
      <ContextPanel
        contactId={contact.id}
        backend={backend}
        open={open === 'context'}
        onOpenChange={(next) => {
          if (!next) onClose()
        }}
      />
    </>
  )
}

function RenameContactDialog({
  contact,
  onClose
}: {
  contact: Contact
  onClose: () => void
}): React.JSX.Element {
  const [draftName, setDraftName] = useState(contact.displayName)
  const { rename, isPending: saving, error: renameError } = useRenameContact()

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Rename contact</DialogTitle>
          <DialogDescription>
            Only the name changes. The repository, the persona and the session it has been building
            carry on as they were.
          </DialogDescription>
        </DialogHeader>
        <Field label="Name" htmlFor="contact-name" {...(renameError ? { error: renameError } : {})}>
          <Input
            id="contact-name"
            value={draftName}
            autoFocus
            onChange={(event) => setDraftName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && draftName.trim()) {
                rename(contact.id, draftName, onClose)
              }
            }}
          />
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!draftName.trim() || draftName.trim() === contact.displayName || saving}
            onClick={() => rename(contact.id, draftName, onClose)}
          >
            {saving ? 'Saving…' : 'Rename'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Two-step by design, driven by main rather than guessed at here.
 * deleteContact refuses when the worktree has uncommitted work, and that
 * refusal is a decision to put in front of the user, not an error to
 * render red somewhere and leave them stuck on.
 *
 * So this one dialog does not dismiss itself on confirm — the answer has
 * to come back first. Asked once, it explains what goes. Refused, the same
 * dialog stays put, shows main's own words, and offers a differently
 * worded button that says what the second press will actually do.
 */
function DeleteContactDialog({
  contact,
  onClose
}: {
  contact: Contact
  onClose: () => void
}): React.JSX.Element {
  const setSelected = useUiStore((state) => state.setSelectedConversation)
  const { remove, isPending: deleting, error: deleteError } = useDeleteContact()

  /**
   * Main refused, and the only refusal it issues here is the dirty-worktree
   * one. Nothing in this component reads git: main's refusal is the
   * authoritative check, and a status read from the renderer could only ever
   * disagree with it under a race.
   */
  const refused = deleteError !== null

  return (
    <ConfirmDeleteDialog
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      closeOnConfirm={false}
      busy={deleting}
      title={refused ? 'Discard uncommitted work?' : `Delete “${contact.displayName}”?`}
      description={
        refused
          ? 'This contact has changes that exist nowhere else. Deleting it now throws them away.'
          : 'The conversation and any routines bound to it go. Committed work on its branch stays, and so does what it spent.'
      }
      {...(refused ? { consequence: deleteError } : {})}
      confirmLabel={
        deleting ? 'Deleting…' : refused ? 'Delete and discard changes' : 'Delete contact'
      }
      onConfirm={() =>
        remove(contact.id, refused, () => {
          onClose()
          setSelected(null)
        })
      }
    />
  )
}
