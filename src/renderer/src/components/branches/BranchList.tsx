import { GitBranch } from 'lucide-react'
import { EmptyState } from '@/components/common/EmptyState'
import { useBranches } from '@/hooks/useBranches'
import { repoName } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useUiStore } from '@/store/useUiStore'
import type { BranchSummary } from '../../../../shared/ipc-contract'

interface BranchListProps {
  query: string
}

/**
 * Every persona branch, newest first.
 *
 * Grouped by repo because a branch name is only unique within one, and because
 * "what is outstanding on this project" is the question the panel answers.
 */
export function BranchList({ query }: BranchListProps): React.JSX.Element {
  const { data: branches = [], isLoading } = useBranches()
  const selected = useUiStore((state) => state.selectedBranch)
  const setSelected = useUiStore((state) => state.setSelectedBranch)

  const needle = query.trim().toLowerCase()
  const matching = needle
    ? branches.filter(
        (branch) =>
          branch.branch.toLowerCase().includes(needle) ||
          (branch.contactName ?? '').toLowerCase().includes(needle) ||
          branch.repoPath.toLowerCase().includes(needle)
      )
    : branches

  if (isLoading) {
    return <p className="text-muted-foreground px-2 py-6 text-center text-xs">Reading branches…</p>
  }

  if (matching.length === 0) {
    return (
      <EmptyState
        icon={GitBranch}
        title={needle ? 'No matching branches' : 'No open branches'}
        description={
          needle
            ? 'Nothing here matches that search.'
            : 'Personas working in their own checkouts will show their branches here.'
        }
      />
    )
  }

  const byRepo = new Map<string, BranchSummary[]>()
  for (const branch of matching) {
    byRepo.set(branch.repoPath, [...(byRepo.get(branch.repoPath) ?? []), branch])
  }

  return (
    <div className="flex flex-col gap-3">
      {[...byRepo.entries()].map(([repoPath, repoBranches]) => (
        <div key={repoPath} className="flex flex-col gap-0.5">
          <p className="text-muted-foreground px-2 pt-1 text-meta font-medium tracking-wide uppercase">
            {repoName(repoPath)}
          </p>
          {repoBranches.map((branch) => {
            const active = selected?.repoPath === repoPath && selected.branch === branch.branch
            return (
              <button
                key={branch.branch}
                type="button"
                onClick={() => setSelected({ repoPath, branch: branch.branch })}
                className={cn(
                  'focus-visible:ring-ring/50 flex w-full flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left outline-none focus-visible:ring-2',
                  active ? 'bg-accent' : 'hover:bg-accent/50'
                )}
              >
                <span className="w-full truncate font-mono text-row">{branch.branch}</span>
                <span className="text-muted-foreground truncate text-xs">
                  {/* Named rather than left blank: a branch whose Contact was
                      deleted is the one most likely to be forgotten, so it says
                      so instead of showing an empty line. */}
                  {branch.contactName ?? 'No contact'} ·{' '}
                  {branch.files.length === 1 ? '1 file' : `${branch.files.length} files`}
                </span>
              </button>
            )
          })}
        </div>
      ))}
    </div>
  )
}
