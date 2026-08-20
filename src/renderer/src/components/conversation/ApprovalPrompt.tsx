import { FileQuestion } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useResolveApproval } from '@/hooks/useMessages'
import type { ActiveRun } from '../../../../shared/ipc-contract'

interface ApprovalPromptProps {
  runId: string
  approval: NonNullable<ActiveRun['approval']>
  /** Who is asking — named in the group thread, where several personas post. */
  personaName?: string
}

/**
 * An `ask_writes` turn's held write, as a decision in the thread.
 *
 * Message-shaped on purpose — the persona is asking the user something, and
 * this app's metaphor says questions arrive in the conversation, not in a
 * modal over it. Rendered from `runs.list` rather than the live stream store,
 * so it survives a renderer reload and appears for turns nobody started from
 * this window — a routine's ask is exactly the one that must not depend on
 * the right component having been mounted when it fired.
 *
 * Both buttons disable together on the first click: the answer is on its way
 * to main, and a second opinion would only be refused as stale. A card that
 * *is* stale (the ask timed out, or was answered elsewhere) resolves to
 * `resolved: false` and disappears with the refetch — nothing to explain to
 * the user beyond the card no longer being there.
 */
export function ApprovalPrompt({
  runId,
  approval,
  personaName
}: ApprovalPromptProps): React.JSX.Element {
  const { resolve, isPending } = useResolveApproval()

  return (
    <div className="border-border bg-card mr-12 max-w-xl self-start rounded-lg border p-3">
      <div className="text-muted-foreground flex items-center gap-1.5 text-meta font-medium tracking-wide uppercase">
        <FileQuestion className="size-3.5" aria-hidden />
        {personaName ? `${personaName} is asking to write` : 'Asking to write'}
      </div>
      <code className="bg-muted text-foreground/90 mt-2 block overflow-x-auto rounded px-2 py-1.5 font-mono text-row whitespace-pre">
        {approval.detail}
      </code>
      <div className="mt-2.5 flex items-center gap-2">
        <Button size="sm" disabled={isPending} onClick={() => resolve(runId, approval.id, true)}>
          Approve
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={isPending}
          onClick={() => resolve(runId, approval.id, false)}
        >
          Deny
        </Button>
        <span className="text-muted-foreground text-meta">
          Refused automatically if nobody answers.
        </span>
      </div>
    </div>
  )
}
