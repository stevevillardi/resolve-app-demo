import { GitPullRequest } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { GithubScope } from '@/types'

interface OpenPRButtonProps {
  githubScope: GithubScope
  onClick?: () => void
}

// githubScope is an independent permission axis from the filesystem sandbox
// (blueprint §9). read_only hides write actions entirely rather than just
// disabling them — a stronger, clearer signal than a greyed-out button.
export function OpenPRButton({
  githubScope,
  onClick
}: OpenPRButtonProps): React.JSX.Element | null {
  if (githubScope === 'read_only') return null

  const copy =
    githubScope === 'open_pr'
      ? 'Pushes a branch and opens a pull request for review. This persona cannot merge.'
      : 'Pushes a branch and opens a pull request. This persona can also merge it.'

  return (
    <Tooltip>
      {/* `render`, not children — the default TooltipTrigger is a <button>, so
          wrapping one nests a button inside a button. */}
      <TooltipTrigger
        render={
          <Button variant="outline" size="sm" onClick={onClick} className="gap-1.5">
            <GitPullRequest className="size-3.5" />
            Open PR
          </Button>
        }
      />
      <TooltipContent>
        <span className="max-w-52 block">{copy}</span>
      </TooltipContent>
    </Tooltip>
  )
}
