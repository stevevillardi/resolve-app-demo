import { registerProcedure } from '../registerProcedure'
import {
  commitBranchWork,
  discardBranch,
  listPersonaBranches,
  mergeIntoWorkingPath,
  mergeTargetsFor,
  previewMerge
} from '../../services/branches'
import { branchDiff } from '../../services/diffs'

/**
 * The part of worktree isolation a human drives.
 *
 * Isolating a writing Contact into its own worktree, and reconciling what git
 * actually did afterwards, both happen automatically — and reading another
 * persona's branch needs nothing from here. Moving that work into a working
 * copy is a decision, so it goes through a click.
 */

registerProcedure('branches.list', () => listPersonaBranches())
registerProcedure('branches.targets', ({ repoPath }) => mergeTargetsFor(repoPath))
registerProcedure('branches.preview', ({ repoPath, targetPath, branch }) =>
  previewMerge(repoPath, targetPath, branch)
)
registerProcedure('branches.merge', ({ repoPath, targetPath, branch }) =>
  mergeIntoWorkingPath(repoPath, targetPath, branch)
)
registerProcedure('branches.diff', ({ repoPath, branch }) => branchDiff(repoPath, branch))
registerProcedure('branches.commit', ({ repoPath, branch, message }) =>
  commitBranchWork(repoPath, branch, message)
)
registerProcedure('branches.discard', ({ repoPath, branch, force }) =>
  discardBranch(repoPath, branch, force ?? false)
)
