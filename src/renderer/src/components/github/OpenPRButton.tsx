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
      ? 'Opens a pull request for review — this persona cannot push directly or merge.'
      : 'Pushes a branch and opens a pull request. This persona also has merge access.'

  return (
    <Tooltip>
      <TooltipTrigger>
        <Button variant="outline" size="sm" onClick={onClick} className="gap-1.5">
          <GitPullRequest className="size-3.5" />
          Open PR
        </Button>
      </TooltipTrigger>
      <TooltipContent>{copy}</TooltipContent>
    </Tooltip>
  )
}
