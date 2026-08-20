import { useState } from 'react'
import { GitBranch, Trash2 } from 'lucide-react'
import { ConfirmDeleteDialog } from '@/components/common/ConfirmDeleteDialog'
import { EmptyState } from '@/components/common/EmptyState'
import { ListRow } from '@/components/common/ListRow'
import { ContextMenuContent, ContextMenuItem } from '@/components/ui/context-menu'
import { useBranches, useDiscardBranch } from '@/hooks/useBranches'
import { repoName } from '@/lib/format'
import { filterList, isFiltering, noMatchDescription, type ListFilter } from '@/lib/list-filter'
import {
  FACET_REPO,
  FACET_STATE,
  STATE_ORPHANED,
  STATE_UNCOMMITTED,
  STATE_UNMERGED
} from '@/lib/section-facets'
import { useUiStore } from '@/store/useUiStore'
import type { BranchSummary } from '../../../../shared/ipc-contract'

interface BranchListProps {
  filter: ListFilter
}

/**
 * Right-click discard for a branch row — the same dialog and file-list
 * consequence as the detail pane's button. Discard is the only action here on
 * purpose: merging and opening a PR both need the detail pane's context (a
 * target to choose, a conflict preview to read), and offering them from a menu
 * without that context would make the irreversible path the most casual one.
 */
function BranchRowMenu({ branch }: { branch: BranchSummary }): React.JSX.Element {
  const [confirmingDiscard, setConfirmingDiscard] = useState(false)
  const selected = useUiStore((state) => state.selectedBranch)
  const setSelected = useUiStore((state) => state.setSelectedBranch)
  const { discard, isPending: discarding } = useDiscardBranch()

  return (
    <>
      <ContextMenuContent>
        <ContextMenuItem variant="destructive" onClick={() => setConfirmingDiscard(true)}>
          <Trash2 />
          Discard branch…
        </ContextMenuItem>
      </ContextMenuContent>

      {confirmingDiscard && (
        <ConfirmDeleteDialog
          open
          onOpenChange={(next) => !next && setConfirmingDiscard(false)}
          title={`Discard ${branch.branch}?`}
          description="The branch and its checkout go. Anything committed only here goes with them."
          consequence={
            branch.files.length > 0 ? (
              <>
                <p className="mb-1 font-medium">
                  {branch.files.length === 1
                    ? '1 file would be lost:'
                    : `${branch.files.length} files would be lost:`}
                </p>
                <ul className="flex flex-col gap-0.5">
                  {branch.files.map((file) => (
                    <li key={file} className="truncate font-mono">
                      {file}
                    </li>
                  ))}
                </ul>
              </>
            ) : undefined
          }
          confirmLabel={discarding ? 'Discarding…' : 'Discard permanently'}
          onConfirm={() =>
            discard({ repoPath: branch.repoPath, branch: branch.branch, force: true }, () => {
              setConfirmingDiscard(false)
              if (selected?.repoPath === branch.repoPath && selected.branch === branch.branch) {
                setSelected(null)
              }
            })
          }
        />
      )}
    </>
  )
}

/**
 * Every persona branch, newest first.
 *
 * Grouped by repo because a branch name is only unique within one, and because
 * "what is outstanding on this project" is the question the panel answers.
 */
export function BranchList({ filter }: BranchListProps): React.JSX.Element {
  const { data: branches = [], isLoading, isError } = useBranches()
  const selected = useUiStore((state) => state.selectedBranch)
  const setSelected = useUiStore((state) => state.setSelectedBranch)

  const filtering = isFiltering(filter)
  const matching = filterList(
    branches,
    filter,
    {
      [FACET_REPO]: (branch) => [branch.repoPath],
      [FACET_STATE]: (branch) => [
        ...(branch.merged ? [] : [STATE_UNMERGED]),
        ...(branch.dirtyFiles.length > 0 ? [STATE_UNCOMMITTED] : []),
        // An orphan has no persona left to authorise anything and can only be
        // merged or discarded — the branches most at risk of being forgotten,
        // and the reason `listPersonaBranches` reads git rather than the table.
        ...(branch.contactId === null ? [STATE_ORPHANED] : [])
      ]
    },
    (branch) => ({
      label: branch.branch,
      detail: branch.repoPath,
      keywords: [branch.contactName ?? '']
    })
  )

  if (isLoading) {
    // The same shape every other list uses while it waits. This was a bare
    // centred paragraph, which is the one loading state in the app that did not
    // look like the others.
    return <EmptyState compact loading title="Reading branches…" />
  }

  // Worded for what actually fails here. This read shells out to git rather
  // than to the database, and `branchesIn` already swallows one unreachable
  // repository — so reaching this means the call itself failed, not that a
  // checkout moved.
  if (isError) {
    return (
      <EmptyState
        compact
        error
        title="Couldn’t read branches"
        description="Git did not answer. Check that the repositories are still where the contacts point."
      />
    )
  }

  if (matching.length === 0) {
    return (
      <EmptyState
        compact
        icon={GitBranch}
        title={filtering ? 'No matching branches' : 'No open branches'}
        description={
          filtering
            ? noMatchDescription(filter)
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
              <ListRow
                key={branch.branch}
                active={active}
                onSelect={() => setSelected({ repoPath, branch: branch.branch })}
                contextMenu={<BranchRowMenu branch={branch} />}
              >
                <span className="block w-full truncate font-mono text-row">{branch.branch}</span>
                <span className="text-muted-foreground mt-0.5 block truncate text-xs">
                  {/* Named rather than left blank: a branch whose Contact was
                      deleted is the one most likely to be forgotten, so it says
                      so instead of showing an empty line. */}
                  {branch.contactName ?? 'No contact'} ·{' '}
                  {branch.files.length === 1 ? '1 file' : `${branch.files.length} files`}
                </span>
              </ListRow>
            )
          })}
        </div>
      ))}
    </div>
  )
}
