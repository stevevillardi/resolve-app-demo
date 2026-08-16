import { useState } from 'react'
import { MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { ConfirmDeleteDialog } from '@/components/common/ConfirmDeleteDialog'
import { Field } from '@/components/common/Field'
import { useDeleteContact, useRenameContact } from '@/hooks/useConversations'
import { useUiStore } from '@/store/useUiStore'
import type { Contact } from '@/types'

/**
 * Rename and delete for the selected Contact.
 *
 * There was no way to do either: `contacts.delete` had existed in main since
 * Phase 12, with worktree cleanup and a two-step refusal, and nothing in the
 * renderer ever called it. Renaming was not possible at all.
 *
 * Header rather than a per-row menu on the conversation list. Both actions are
 * taken about once per contact per lifetime, and a hover affordance on every
 * row of the densest list in the app is a poor trade for that.
 */
export function ContactMenu({ contact }: { contact: Contact }): React.JSX.Element {
  const [renaming, setRenaming] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [draftName, setDraftName] = useState(contact.displayName)
  const setSelected = useUiStore((state) => state.setSelectedConversation)
  const { rename, isPending: saving, error: renameError, reset: resetRename } = useRenameContact()
  const { remove, isPending: deleting, error: deleteError, reset: resetDelete } = useDeleteContact()

  /**
   * Main refused, and the only refusal it issues here is the dirty-worktree
   * one. Nothing in this component reads git: main's refusal is the
   * authoritative check, and a status read from the renderer could only ever
   * disagree with it under a race.
   */
  const refused = deleteError !== null

  const openDelete = (): void => {
    resetDelete()
    setConfirmingDelete(true)
  }

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
          <DropdownMenuItem
            onClick={() => {
              resetRename()
              setDraftName(contact.displayName)
              setRenaming(true)
            }}
          >
            <Pencil />
            Rename…
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={openDelete}>
            <Trash2 />
            Delete contact…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={renaming} onOpenChange={setRenaming}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Rename contact</DialogTitle>
            <DialogDescription>
              Only the name changes. The repository, the persona and the session it has been
              building carry on as they were.
            </DialogDescription>
          </DialogHeader>
          <Field
            label="Name"
            htmlFor="contact-name"
            {...(renameError ? { error: renameError } : {})}
          >
            <Input
              id="contact-name"
              value={draftName}
              autoFocus
              onChange={(event) => setDraftName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && draftName.trim()) {
                  rename(contact.id, draftName, () => setRenaming(false))
                }
              }}
            />
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenaming(false)}>
              Cancel
            </Button>
            <Button
              disabled={!draftName.trim() || draftName.trim() === contact.displayName || saving}
              onClick={() => rename(contact.id, draftName, () => setRenaming(false))}
            >
              {saving ? 'Saving…' : 'Rename'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/*
        Two-step by design, driven by main rather than guessed at here.
        deleteContact refuses when the worktree has uncommitted work, and that
        refusal is a decision to put in front of the user, not an error to
        render red somewhere and leave them stuck on.

        So this one dialog does not dismiss itself on confirm — the answer has
        to come back first. Asked once, it explains what goes. Refused, the same
        dialog stays put, shows main's own words, and offers a differently
        worded button that says what the second press will actually do.
      */}
      <ConfirmDeleteDialog
        open={confirmingDelete}
        onOpenChange={(open) => {
          setConfirmingDelete(open)
          if (!open) resetDelete()
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
            setConfirmingDelete(false)
            setSelected(null)
          })
        }
      />
    </>
  )
}
