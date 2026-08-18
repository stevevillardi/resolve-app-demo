import { useState } from 'react'
import { Eye, EyeOff, FolderOpen, Pencil, RotateCcw } from 'lucide-react'
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
import { Field } from '@/components/common/Field'
import { revealLocalPath } from '@/hooks/useDiffs'
import { useRenameGroup, useSetGroupHidden } from '@/hooks/useConversations'
import { groupName, repoName } from '@/lib/format'
import type { Group } from '@/types'

/**
 * The group actions, shared between the conversation list's right-click menu
 * and the group thread header's ⋯ menu (review §G5).
 *
 * Modelled on `ContactActions` deliberately, down to the `Item` alias that lets
 * one definition serve both menu families: a group row acquiring a menu that
 * behaved differently from a contact row's would be a worse outcome than it
 * having none, which is what it had.
 *
 * Three verbs, and the two that are missing are the point. There is no delete,
 * because a group is a *view* of the contacts bound to a repository — deleting
 * the row while those contacts exist only means `ensureGroupForRepo` recreating
 * it on the next turn, with its read boundary reset so every old message
 * reappears as unread. And there is no "add member": membership is
 * `contacts.repoPath`, so joining a group is what binding a contact to that
 * repository already does.
 */

export type GroupDialogKind = 'rename' | 'hide'

interface GroupActionItemsProps {
  /** Which menu family these items render into — they must match their popup. */
  kind: 'dropdown' | 'context'
  group: Group
  onOpen: (dialog: GroupDialogKind) => void
}

export function GroupActionItems({
  kind,
  group,
  onOpen
}: GroupActionItemsProps): React.JSX.Element {
  const Item = kind === 'dropdown' ? DropdownMenuItem : ContextMenuItem
  const Separator = kind === 'dropdown' ? DropdownMenuSeparator : ContextMenuSeparator
  const { setHidden } = useSetGroupHidden()
  const { rename } = useRenameGroup()

  return (
    <>
      <Item onClick={() => onOpen('rename')}>
        <Pencil />
        Rename…
      </Item>
      {/*
        Only offered while a name is actually overriding something. On a group
        still showing its repository's name this would be a no-op wearing the
        label of an action.
      */}
      {group.name !== null && (
        <Item onClick={() => rename(group.id, null)}>
          <RotateCcw />
          Use the repository name
        </Item>
      )}
      <Item onClick={() => revealLocalPath(group.repoPath)}>
        <FolderOpen />
        Reveal repository
      </Item>
      <Separator />
      {group.hidden ? (
        // Unhiding needs no confirmation — it puts something back.
        <Item onClick={() => setHidden(group.id, false)}>
          <Eye />
          Show in the list
        </Item>
      ) : (
        <Item onClick={() => onOpen('hide')}>
          <EyeOff />
          Hide from the list
        </Item>
      )}
    </>
  )
}

export function GroupActionDialogs({
  group,
  open,
  onClose
}: {
  group: Group
  open: GroupDialogKind | null
  onClose: () => void
}): React.JSX.Element {
  // Mounted per opening, so each attempt starts from a clean draft rather than
  // from whatever the last cancelled one left behind.
  return (
    <>
      {open === 'rename' && <RenameGroupDialog group={group} onClose={onClose} />}
      {open === 'hide' && <HideGroupDialog group={group} onClose={onClose} />}
    </>
  )
}

function RenameGroupDialog({
  group,
  onClose
}: {
  group: Group
  onClose: () => void
}): React.JSX.Element {
  const [draftName, setDraftName] = useState(groupName(group))
  const { rename, isPending: saving, error: renameError } = useRenameGroup()
  const derived = repoName(group.repoPath)
  const trimmed = draftName.trim()

  /**
   * Typing the repository's own name back in clears the override rather than
   * storing a copy of it. Otherwise the two would be indistinguishable on
   * screen and diverge later — a repository moved on disk would keep rendering
   * the old folder name with nothing to explain why.
   */
  const submit = (): void => rename(group.id, trimmed === derived ? null : trimmed, onClose)

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Rename group</DialogTitle>
          <DialogDescription>
            Only the name in this app changes. The repository on disk, its path, and the personas
            working in it are untouched.
          </DialogDescription>
        </DialogHeader>
        <Field label="Name" htmlFor="group-name" {...(renameError ? { error: renameError } : {})}>
          <Input
            id="group-name"
            value={draftName}
            autoFocus
            onChange={(event) => setDraftName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && trimmed) submit()
            }}
          />
        </Field>
        <DialogFooter>
          {/*
            Only once there is something to clear, and it is the reset rather
            than a second kind of rename — `name: null` is what the column
            stores for "use the repository's name".
          */}
          {group.name !== null && (
            <Button
              variant="ghost"
              className="mr-auto"
              disabled={saving}
              onClick={() => rename(group.id, null, onClose)}
            >
              Use “{derived}”
            </Button>
          )}
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!trimmed || trimmed === groupName(group) || saving} onClick={submit}>
            {saving ? 'Saving…' : 'Rename'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function HideGroupDialog({
  group,
  onClose
}: {
  group: Group
  onClose: () => void
}): React.JSX.Element {
  const { setHidden, isPending: saving, error } = useSetGroupHidden()

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Hide {groupName(group)}?</DialogTitle>
          <DialogDescription>
            It leaves the conversation list and nothing else happens. Its messages, its spend and
            its unread count carry on being recorded, so bringing it back gives you the whole thread
            rather than one that starts from today. The personas working in this repository are
            unaffected.
          </DialogDescription>
        </DialogHeader>
        {error && <p className="text-destructive text-sm">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={saving} onClick={() => setHidden(group.id, true, onClose)}>
            {saving ? 'Hiding…' : 'Hide'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
