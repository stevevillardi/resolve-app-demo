import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import { groupMessagesRootKey } from '@/hooks/useMessages'
import { callProcedure, ipcErrorMessage } from '@/lib/ipc-client'
import type { BranchSummary, MergeTarget } from '../../../shared/ipc-contract'

export const branchesKey = ['branches'] as const

/**
 * Every persona branch across every bound repo.
 *
 * Each call shells out to git per repo, so this is not something to poll. It is
 * refetched when something merges or is discarded, which are the only two
 * things in the app that change the answer — a *new* branch appears when a turn
 * ends, and the panel is somewhere the user navigates to rather than watches.
 */
export function useBranches(): UseQueryResult<BranchSummary[]> {
  return useQuery({
    queryKey: branchesKey,
    queryFn: () => callProcedure('branches.list', undefined)
  })
}

export function useMergeTargets(repoPath: string | null): UseQueryResult<MergeTarget[]> {
  return useQuery({
    queryKey: ['branches', 'targets', repoPath] as const,
    queryFn: () => callProcedure('branches.targets', { repoPath: repoPath as string }),
    enabled: repoPath !== null
  })
}

/**
 * The conflict check, run before the merge button is clicked rather than after.
 *
 * `git merge-tree` performs the merge in the object store, so asking this
 * question costs nothing and changes nothing — which is what makes it safe to
 * run automatically as soon as a target is picked.
 */
export function useMergePreview(
  repoPath: string | null,
  targetPath: string | null,
  branch: string | null
): UseQueryResult<{ clean: boolean; conflicts: string[] }> {
  return useQuery({
    queryKey: ['branches', 'preview', repoPath, targetPath, branch] as const,
    queryFn: () =>
      callProcedure('branches.preview', {
        repoPath: repoPath as string,
        targetPath: targetPath as string,
        branch: branch as string
      }),
    enabled: repoPath !== null && targetPath !== null && branch !== null
  })
}

export function useMergeBranch(): {
  merge: (
    input: { repoPath: string; targetPath: string; branch: string },
    onMerged?: () => void
  ) => void
  isPending: boolean
  error: string | null
} {
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: (input: { repoPath: string; targetPath: string; branch: string }) =>
      callProcedure('branches.merge', input),
    // Every branch's file list is measured against a working copy that just
    // changed, so the whole list is stale rather than one row of it. The merge
    // also stamped any branch_request it answered, so the group threads and
    // the cached diffs move with it.
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: branchesKey })
      void queryClient.invalidateQueries({ queryKey: groupMessagesRootKey })
      void queryClient.invalidateQueries({ queryKey: ['diff'] })
    }
  })

  return {
    merge: (input, onMerged) => mutation.mutate(input, { onSuccess: onMerged }),
    isPending: mutation.isPending,
    error: mutation.error ? ipcErrorMessage(mutation.error) : null
  }
}

export function useDiscardBranch(): {
  discard: (
    input: { repoPath: string; branch: string; force?: boolean },
    onDone?: () => void
  ) => void
  isPending: boolean
  error: string | null
} {
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: (input: { repoPath: string; branch: string; force?: boolean }) =>
      callProcedure('branches.discard', input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: branchesKey })
      void queryClient.invalidateQueries({ queryKey: groupMessagesRootKey })
      void queryClient.invalidateQueries({ queryKey: ['diff'] })
    }
  })

  return {
    discard: (input, onDone) => mutation.mutate(input, { onSuccess: onDone }),
    isPending: mutation.isPending,
    error: mutation.error ? ipcErrorMessage(mutation.error) : null
  }
}
