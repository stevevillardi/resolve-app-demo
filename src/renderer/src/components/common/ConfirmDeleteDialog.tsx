import { AlertTriangle } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'

interface ConfirmDeleteDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  /** What the user loses. Be specific — this is the last stop before it's gone. */
  description: string
  /**
   * The specifics, when there are any: the files that would be lost, the
   * personas that would be detached, the uncommitted work main refused over.
   *
   * Separate from `description` because these are a *list* and the description
   * is a sentence. Cramming "3 contacts are still bound to it: a, b, c" into
   * one line is how a dialog ends up saying the most important thing in its
   * least readable place.
   */
  consequence?: React.ReactNode
  confirmLabel?: string
  onConfirm: () => void
}

/**
 * Deletes in this app are permanent and immediate — there's no undo and no
 * trash — so every one of them goes through here rather than firing straight
 * off a button. Shared so the destructive actions can't drift into different
 * levels of caution, which they had: the branch pane used to confirm with a
 * pair of buttons that appeared in place, making the one irreversible action
 * in the app look like the most casual.
 *
 * The medallion is not decoration. Everything else in this app is quiet on
 * purpose, so a dialog that is quiet too reads as routine — and this is the
 * one surface that must not. It is the only place `destructive` appears as a
 * fill rather than as button text.
 */
export function ConfirmDeleteDialog({
  open,
  onOpenChange,
  title,
  description,
  consequence,
  confirmLabel = 'Delete',
  onConfirm
}: ConfirmDeleteDialogProps): React.JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="flex-row items-start gap-3">
          <span
            aria-hidden
            className="bg-destructive/10 text-destructive flex size-9 shrink-0 items-center justify-center rounded-lg"
          >
            <AlertTriangle className="size-[18px]" />
          </span>
          <div className="flex min-w-0 flex-col gap-1.5">
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </div>
        </DialogHeader>

        {consequence && (
          // Capped and scrolling: a branch with forty changed files must not
          // push the confirm button off the bottom of the screen.
          <ScrollArea className="border-border max-h-40 rounded-lg border">
            <div className="text-muted-foreground p-3 text-xs">{consequence}</div>
          </ScrollArea>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              onConfirm()
              onOpenChange(false)
            }}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
