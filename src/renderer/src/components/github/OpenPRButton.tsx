import { ExternalLink, GitPullRequest } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { openExternal } from '@/hooks/useAuth'
import type { PrRef } from '../../../../shared/ipc-contract'
import type { GithubScope } from '@/types'

interface OpenPRButtonProps {
  githubScope: GithubScope
  /**
   * Whether this Contact has a pull-request path at all — a git repo, a GitHub
   * remote, a branch of its own. False hides the action rather than offering
   * one that can only fail.
   */
  available: boolean
  /** The pull request this branch already has, if any. */
  pr: PrRef | null
  isPending: boolean
  onOpen: () => void
}

// githubScope is an independent permission axis from the filesystem sandbox:
// what a persona may do on GitHub is set separately from what it may touch on
// disk. read_only hides write actions entirely rather than just disabling
// them — a stronger, clearer signal than a greyed-out button. The
// real gate is in the main process (pull-requests.ts); this is the UI half of
// the same decision, not the enforcement.
export function OpenPRButton({
  githubScope,
  available,
  pr,
  isPending,
  onOpen
}: OpenPRButtonProps): React.JSX.Element | null {
  if (githubScope === 'read_only' || !available) return null

  const copy = pr
    ? `Pushes the new commits on this branch and comments on pull request #${pr.number}.`
    : githubScope === 'open_pr'
      ? 'Pushes a branch and opens a pull request for review. This persona cannot merge.'
      : 'Pushes a branch and opens a pull request. This persona can also merge it.'

  return (
    <>
      {pr && (
        <Button variant="ghost" size="sm" className="gap-1" onClick={() => openExternal(pr.url)}>
          #{pr.number}
          <ExternalLink className="size-3" />
        </Button>
      )}
      <Tooltip>
        {/* `render`, not children — the default TooltipTrigger is a <button>, so
          wrapping one nests a button inside a button. */}
        <TooltipTrigger
          render={
            <Button
              variant="outline"
              size="sm"
              onClick={onOpen}
              disabled={isPending}
              className="gap-1.5"
            >
              <GitPullRequest className="size-3.5" />
              {isPending ? 'Pushing…' : pr ? 'Update PR' : 'Open PR'}
            </Button>
          }
        />
        <TooltipContent>
          <span className="block max-w-52">{copy}</span>
        </TooltipContent>
      </Tooltip>
    </>
  )
}
