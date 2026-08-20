import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { DiffPanel } from '@/components/diff/DiffPanel'
import { useWorkDiff } from '@/hooks/useDiffs'
import { ipcErrorMessage } from '@/lib/ipc-client'

/**
 * One turn's diff, in place.
 *
 * A dialog rather than a navigation: the question "what did that reply
 * change" is asked mid-conversation, and the answer should not cost the
 * reader their place in it. The query only runs while a message id is set, so
 * a thread full of chips costs nothing until one is opened.
 */
export function WorkDiffDialog({
  contactId,
  messageId,
  onClose
}: {
  contactId: string
  messageId: string | null
  onClose: () => void
}): React.JSX.Element {
  const diff = useWorkDiff(contactId, messageId)

  return (
    <Dialog open={messageId !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex h-[80vh] flex-col sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>What this turn changed</DialogTitle>
          <DialogDescription>
            As git saw it when the turn finished. Files marked live are read from the folder as it
            is now.
          </DialogDescription>
        </DialogHeader>
        <DiffPanel
          files={diff.data?.files ?? []}
          filesOmitted={diff.data?.filesOmitted ?? 0}
          isLoading={diff.isLoading}
          error={diff.error ? ipcErrorMessage(diff.error) : null}
          emptyText="Nothing to show — these changes may have been merged or discarded since."
          className="min-h-0 flex-1"
        />
      </DialogContent>
    </Dialog>
  )
}
