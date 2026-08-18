import { useState } from 'react'
import {
  Layers,
  Loader2,
  Pencil,
  RefreshCcw,
  RotateCcw,
  Trash2,
  UserRoundPen,
  FolderOpen
} from 'lucide-react'
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
import { toast } from 'sonner'
import { AvatarColorSwatch } from '@/components/common/AvatarColorSwatch'
import { ListRow } from '@/components/common/ListRow'
import {
  useDeleteContact,
  useRebindPersona,
  useRenameContact,
  useStartFreshSession
} from '@/hooks/useConversations'
import { revealLocalPath } from '@/hooks/useDiffs'
import { usePersonas } from '@/hooks/usePersonas'
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

export type ContactDialogKind = 'context' | 'rename' | 'rebind' | 'freshSession' | 'delete'

interface ContactActionItemsProps {
  /** Which menu family these items render into — they must match their popup. */
  kind: 'dropdown' | 'context'
  /** The contact the recreate flow prefills from. */
  contactId: string
  /** Where its session actually works — the worktree when isolated. */
  workingPath: string
  /**
   * Whether there is a backend session to drop. A contact that has never run a
   * turn has nothing to start fresh *from*, so the item is disabled rather than
   * hidden — its absence would read as the feature not existing.
   */
  hasSession: boolean
  onOpen: (dialog: ContactDialogKind) => void
}

export function ContactActionItems({
  kind,
  contactId,
  workingPath,
  hasSession,
  onOpen
}: ContactActionItemsProps): React.JSX.Element {
  const Item = kind === 'dropdown' ? DropdownMenuItem : ContextMenuItem
  const Separator = kind === 'dropdown' ? DropdownMenuSeparator : ContextMenuSeparator
  const setDialog = useUiStore((state) => state.setDialog)
  const setRecreateContactId = useUiStore((state) => state.setRecreateContactId)

  return (
    <>
      <Item onClick={() => onOpen('context')}>
        <Layers />
        What it works with…
      </Item>
      <Item onClick={() => revealLocalPath(workingPath)}>
        <FolderOpen />
        Reveal working folder
      </Item>
      <Item onClick={() => onOpen('rename')}>
        <Pencil />
        Rename…
      </Item>
      <Item onClick={() => onOpen('rebind')}>
        <UserRoundPen />
        Change persona…
      </Item>
      {/* Beside Change persona because that is where this used to hide: until
          Phase 22 a rebind's resume-key clear was the only way to get one. */}
      <Item disabled={!hasSession} onClick={() => onOpen('freshSession')}>
        <RotateCcw />
        Start a fresh session…
      </Item>
      {/* Not one of the parent's dialogs: recreate routes into the
          new-contact flow, prefilled. The flow clears the marker on close. */}
      <Item
        onClick={() => {
          setRecreateContactId(contactId)
          setDialog('newContact')
        }}
      >
        <RefreshCcw />
        Recreate…
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
      {open === 'rebind' && <RebindPersonaDialog contact={contact} onClose={onClose} />}
      {open === 'freshSession' && <FreshSessionDialog contact={contact} onClose={onClose} />}
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
 * The one lever over what a turn costs, and the copy is most of the feature.
 *
 * Two things have to land or the action is frightening rather than useful:
 * that nothing visible is lost — the transcript is ours, the backend's memory
 * of it is not — and *why anyone would want this*, which is that every turn is
 * billed for the whole conversation the session can still see. Neither is
 * guessable from the words "fresh session", so both are said.
 */
function FreshSessionDialog({
  contact,
  onClose
}: {
  contact: Contact
  onClose: () => void
}): React.JSX.Element {
  const { startFresh, isPending, error } = useStartFreshSession()

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Start a fresh session?</DialogTitle>
          <DialogDescription>
            Everything you can see stays. {contact.displayName} keeps this repository, its working
            folder and this whole conversation — it just stops <em>remembering</em> the messages
            above, so the next one starts from its instructions and nothing else.
          </DialogDescription>
        </DialogHeader>
        <p className="text-muted-foreground text-row">
          That is also what makes the next message cheap again: a turn is billed for the entire
          conversation its session can still see.
        </p>
        {error && <p className="text-destructive text-row">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={isPending}
            onClick={() =>
              startFresh(contact.id, () => {
                toast('Fresh session — the next message starts with nothing in memory')
                onClose()
              })
            }
          >
            {isPending ? 'Starting…' : 'Start fresh'}
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

/**
 * The persona rebind (Phase 17) — the one binding change contacts.update's
 * narrow shape deliberately left out, now that it has a safe dedicated path.
 * Main clears the resume key in the same transaction and refuses mid-turn;
 * this dialog's job is to say the consequence out loud before asking.
 */
function RebindPersonaDialog({
  contact,
  onClose
}: {
  contact: Contact
  onClose: () => void
}): React.JSX.Element {
  const { data: personas = [] } = usePersonas()
  const { rebind, isPending, error } = useRebindPersona()
  const [chosenId, setChosenId] = useState<string | null>(null)

  const options = personas.filter((persona) => persona.id !== contact.personaTemplateId)

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Change persona</DialogTitle>
          <DialogDescription>
            Starts a fresh backend session under the new persona. The repository, its worktree, and
            the conversation history all stay.
          </DialogDescription>
        </DialogHeader>

        {options.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            There is no other persona to switch to — create one in the Personas section first.
          </p>
        ) : (
          <div className="flex max-h-72 flex-col gap-1.5 overflow-y-auto">
            {options.map((persona) => (
              <ListRow
                key={persona.id}
                active={chosenId === persona.id}
                align="center"
                bordered
                onSelect={() => setChosenId(persona.id)}
                leading={
                  <AvatarColorSwatch
                    name={persona.name}
                    color={persona.avatarColor}
                    seed={persona.id}
                  />
                }
              >
                <span className="block truncate text-row font-medium">{persona.name}</span>
                <span className="text-muted-foreground block text-xs">
                  {persona.backend === 'claude' ? 'Claude' : 'Codex'}
                </span>
              </ListRow>
            ))}
          </div>
        )}

        {error && <p className="text-destructive text-sm text-pretty">{error}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={chosenId === null || isPending}
            onClick={() => {
              if (chosenId === null) return
              rebind(contact.id, chosenId, () => {
                toast('Persona changed — the next message starts a fresh session')
                onClose()
              })
            }}
          >
            {isPending && <Loader2 className="size-4 animate-spin motion-reduce:animate-none" />}
            Change persona
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
