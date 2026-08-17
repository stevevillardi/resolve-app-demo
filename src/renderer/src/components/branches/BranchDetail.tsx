import { useState } from 'react'
import {
  AlertTriangle,
  Check,
  ExternalLink,
  GitBranch,
  GitMerge,
  GitPullRequest,
  Trash2
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ConfirmDeleteDialog } from '@/components/common/ConfirmDeleteDialog'
import { EmptyPane } from '@/components/common/EmptyPane'
import { ListRow } from '@/components/common/ListRow'
import { PaneBody } from '@/components/common/PaneBody'
import { PaneHeader } from '@/components/common/PaneHeader'
import { Section } from '@/components/common/Section'
import {
  useBranches,
  useDiscardBranch,
  useMergeBranch,
  useMergePreview,
  useMergeTargets
} from '@/hooks/useBranches'
import { useOpenPullRequest, usePullRequestState } from '@/hooks/usePullRequests'
import { openExternal } from '@/hooks/useAuth'
import { repoName } from '@/lib/format'
import { useUiStore } from '@/store/useUiStore'

/**
 * One branch, and the two things a human can decide about it.
 *
 * The merge target is chosen explicitly rather than defaulted to the user's own
 * checkout, because merging *for* a persona — into its tree, so it can carry on
 * — is the case this exists for, and defaulting would make the destructive
 * reading the easy one.
 *
 * The conflict check runs as soon as a target is picked rather than on click.
 * `git merge-tree` merges in the object store, so asking costs nothing and
 * touches nothing; there is no reason to make the user find out by trying.
 */
export function BranchDetail(): React.JSX.Element {
  const selected = useUiStore((state) => state.selectedBranch)

  if (!selected) return <NothingSelected />

  // Keyed on the selection so picking another branch remounts rather than
  // reusing this one's state. A target chosen for one branch means nothing for
  // the next, and a stale one would show a conflict preview for a merge nobody
  // asked about.
  return <BranchDetailBody key={`${selected.repoPath} ${selected.branch}`} {...selected} />
}

function NothingSelected(): React.JSX.Element {
  return (
    <EmptyPane
      icon={GitBranch}
      title="No branch selected"
      description="Pick a branch to see what it changed and where it could be merged."
    />
  )
}

function BranchDetailBody({
  repoPath,
  branch: branchName
}: {
  repoPath: string
  branch: string
}): React.JSX.Element {
  const setSelected = useUiStore((state) => state.setSelectedBranch)
  const { data: branches = [] } = useBranches()
  const [targetPath, setTargetPath] = useState<string | null>(null)
  const [confirmingDiscard, setConfirmingDiscard] = useState(false)

  const branch = branches.find(
    (candidate) => candidate.repoPath === repoPath && candidate.branch === branchName
  )

  const { data: targets = [] } = useMergeTargets(repoPath)
  const preview = useMergePreview(repoPath, targetPath, branchName)
  const { merge, isPending: merging, error: mergeError } = useMergeBranch()
  const { discard, isPending: discarding, error: discardError } = useDiscardBranch()

  // Null for an orphan branch, which has no persona left to authorise anything —
  // merge and discard are all it gets.
  const { data: prState } = usePullRequestState(branch?.contactId ?? null)
  const { open: openPr, isPending: opening, error: prError, reset: resetPr } = useOpenPullRequest()

  // Gone from under us — merged and discarded elsewhere, or its repo unmounted.
  if (!branch) return <NothingSelected />

  const target = targets.find((candidate) => candidate.path === targetPath)
  const blocked = Boolean(target?.dirty) || preview.data?.clean === false

  return (
    <div className="bg-background flex h-full min-h-0 flex-col">
      {/*
        The branch name is machine text and PaneHeader's title is sans-serif, so
        the repo takes the title and the branch takes the mono subtitle — the
        same split ThreadView uses for persona name and repo path. That is why
        this needs no `titleMono` prop.

        The contact name is not repeated here: it already contains the repo
        (`Refactor Buddy · checkout-service`), so the old header read
        "checkout-service · Refactor Buddy · checkout-service · 88c574d".
      */}
      <PaneHeader
        leading={<GitBranch className="text-muted-foreground size-4 shrink-0" />}
        title={repoName(branch.repoPath)}
        subtitle={branch.branch}
        actions={
          <>
            {/* Merging takes the work into somebody's checkout; a pull request
                sends it out for review instead. Both are the human's call, which
                is why they sit side by side. Hidden entirely for a read_only
                persona and for a branch whose Contact is gone. */}
            {branch.githubScope !== 'read_only' && prState?.available && branch.contactId && (
              <>
                {prState.pr && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="gap-1"
                    onClick={() => openExternal((prState.pr as { url: string }).url)}
                  >
                    #{prState.pr.number}
                    <ExternalLink className="size-3.5" />
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  disabled={opening}
                  onClick={() => {
                    resetPr()
                    openPr(branch.contactId as string)
                  }}
                >
                  <GitPullRequest className="size-3.5" />
                  {opening ? 'Pushing…' : prState.pr ? 'Update PR' : 'Open PR'}
                </Button>
              </>
            )}
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Discard branch"
              disabled={discarding}
              onClick={() => setConfirmingDiscard(true)}
            >
              <Trash2 className="size-3.5" />
            </Button>
            <Button
              size="sm"
              className="gap-1.5"
              disabled={!targetPath || blocked || merging}
              onClick={() => targetPath && merge({ targetPath, branch: branch.branch })}
            >
              <GitMerge className="size-3.5" />
              {merging ? 'Merging…' : 'Merge'}
            </Button>
          </>
        }
      />

      <PaneBody>
        <div className="text-muted-foreground flex flex-wrap items-center gap-x-2 text-xs">
          <span>{branch.contactName ?? 'No contact'}</span>
          <span aria-hidden>·</span>
          <span className="font-mono">{branch.headSha.slice(0, 7)}</span>
          {!branch.hasWorktree && (
            <>
              <span aria-hidden>·</span>
              <span>checkout removed</span>
            </>
          )}
        </div>

        <Section
          title={
            branch.files.length === 1 ? '1 file changed' : `${branch.files.length} files changed`
          }
        >
          {branch.files.length === 0 ? (
            <p className="text-muted-foreground text-xs">
              Nothing this branch has that your checkout doesn&apos;t.
            </p>
          ) : (
            // A changed-file list is many short strings, so it columnises
            // rather than running down the middle of the pane truncating.
            <ul className="grid gap-x-6 gap-y-0.5 @2xl/pane:grid-cols-2 @5xl/pane:grid-cols-3">
              {branch.files.map((file) => (
                <li key={file} className="text-foreground/85 truncate font-mono text-xs">
                  {file}
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Merge into" description="Where this branch's commits should land.">
          <div className="grid gap-1.5 @3xl/pane:grid-cols-2">
            {targets.map((candidate) => (
              <ListRow
                key={candidate.path}
                active={targetPath === candidate.path}
                onSelect={() => setTargetPath(candidate.path)}
                align="center"
                bordered
                trailing={
                  targetPath === candidate.path ? <Check className="size-4 shrink-0" /> : undefined
                }
              >
                <span className="block truncate text-sm">{candidate.label}</span>
                {candidate.dirty && (
                  <span className="text-muted-foreground block text-xs">
                    Has uncommitted changes — commit or discard them first.
                  </span>
                )}
              </ListRow>
            ))}
          </div>

          {targetPath && (
            <div className="flex flex-col gap-2">
              {preview.isFetching && (
                <p className="text-muted-foreground text-xs">Checking for conflicts…</p>
              )}
              {preview.data?.clean === true && (
                <p className="text-muted-foreground text-xs">
                  Merges cleanly. Uncommitted work in the target is not considered.
                </p>
              )}
              {preview.data?.clean === false && (
                <div className="border-border flex flex-col gap-1 rounded-lg border p-3">
                  <p className="flex items-center gap-1.5 text-xs font-medium">
                    <AlertTriangle className="size-3.5 shrink-0" />
                    Conflicts in {preview.data.conflicts.length}{' '}
                    {preview.data.conflicts.length === 1 ? 'file' : 'files'}
                  </p>
                  <ul className="flex flex-col gap-0.5">
                    {preview.data.conflicts.map((file) => (
                      <li key={file} className="text-muted-foreground font-mono text-xs">
                        {file}
                      </li>
                    ))}
                  </ul>
                  <p className="text-muted-foreground text-xs">
                    Resolve these in your own tools — this app reports conflicts, it doesn&apos;t
                    resolve them.
                  </p>
                </div>
              )}
            </div>
          )}
        </Section>

        {(mergeError ?? discardError ?? prError) && (
          <p className="text-destructive text-xs">{mergeError ?? discardError ?? prError}</p>
        )}
      </PaneBody>

      {/* The same dialog every other destructive action in the app goes
          through. This used to be a pair of buttons that appeared in place,
          which made discarding a branch — the one irreversible action here —
          the most casual-looking of the three. */}
      <ConfirmDeleteDialog
        open={confirmingDiscard}
        onOpenChange={setConfirmingDiscard}
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
          discard({ repoPath: branch.repoPath, branch: branch.branch, force: true }, () =>
            setSelected(null)
          )
        }
      />
    </div>
  )
}
