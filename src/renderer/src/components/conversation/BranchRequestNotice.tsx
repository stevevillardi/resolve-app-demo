import { Check, GitPullRequestArrow } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatTime } from '@/lib/format'
import { cn } from '@/lib/utils'

interface BranchRequestNoticeProps {
  content: string
  branch: string
  authorName?: string
  timestamp?: number
  /** When the ask was answered — a merge or discard stamped it. */
  resolvedAt?: number
  onReview?: (branch: string) => void
}

/**
 * A persona asking for somebody else's branch to be merged into its tree.
 *
 * The only row in the Group thread that asks the *user* for something, and the
 * only one with a control on it. Reading another branch needs no permission and
 * no merge — a persona does that itself — so anything that reaches here is a
 * case where work has to physically move between checkouts, which is a decision
 * rather than a step.
 *
 * Built as a third sibling of RoutineRunNotice and JournalNotice rather than a
 * variant of either: it borrows the log-entry gutter so it sits in the same
 * rhythm, but it is left-aligned with a solid rule and an action, so it stays
 * distinguishable from both in greyscale — which is the rule GroupThreadView
 * sets for these four shapes.
 */
export function BranchRequestNotice({
  content,
  branch,
  authorName,
  timestamp,
  resolvedAt,
  onReview
}: BranchRequestNoticeProps): React.JSX.Element {
  const resolved = resolvedAt !== undefined
  return (
    <div className="flex items-start gap-3 py-0.5 pl-0.5">
      <span className="text-muted-foreground flex w-11 shrink-0 justify-end pt-0.5 font-mono text-micro tabular-nums">
        {timestamp !== undefined ? formatTime(timestamp) : ''}
      </span>
      <span
        className={cn(
          'flex min-w-0 flex-1 items-start gap-2 border-l-2 pl-3',
          // A settled ask recedes to the log's rhythm; only a standing one
          // carries the heavier rule that says "this is for you".
          resolved ? 'border-border opacity-70' : 'border-foreground/25'
        )}
      >
        <GitPullRequestArrow className="text-muted-foreground mt-0.5 size-3.5 shrink-0" />
        <span className="min-w-0 flex-1">
          <span className="text-muted-foreground block text-meta font-medium tracking-wide uppercase">
            {resolved ? 'Merge request · answered' : 'Needs a merge'}
            {authorName ? ` · ${authorName}` : ''}
          </span>
          <span className="text-foreground/85 mt-0.5 block text-row leading-relaxed">
            {content}
          </span>
          <span className="mt-1.5 flex flex-wrap items-center gap-2">
            <code className="bg-muted text-foreground/80 rounded px-1.5 py-0.5 font-mono text-meta">
              {branch}
            </code>
            {resolved ? (
              <span className="text-muted-foreground flex items-center gap-1 text-meta">
                <Check className="size-3" aria-hidden />
                Resolved {formatTime(resolvedAt)}
              </span>
            ) : (
              onReview && (
                <Button variant="outline" size="sm" onClick={() => onReview(branch)}>
                  Review
                </Button>
              )
            )}
          </span>
        </span>
      </span>
    </div>
  )
}
