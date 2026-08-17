import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import { callProcedure, ipcErrorMessage } from '@/lib/ipc-client'
import { branchesKey } from '@/hooks/useBranches'
import type { IpcOutput } from '../../../shared/ipc-contract'

/**
 * The diff surface's reads and the one write beside them (Phase 19).
 *
 * Diff queries shell out to git per call, so they are fetched when a surface
 * opens and refetched only when this file's own mutations invalidate them —
 * never polled.
 */

export function useBranchDiff(
  repoPath: string | null,
  branch: string | null
): UseQueryResult<IpcOutput<'branches.diff'>> {
  return useQuery({
    queryKey: ['diff', 'branch', repoPath, branch] as const,
    queryFn: () =>
      callProcedure('branches.diff', { repoPath: repoPath as string, branch: branch as string }),
    enabled: repoPath !== null && branch !== null
  })
}

/** Enabled is the caller's affair — a chip row should not fetch until opened. */
export function useWorkDiff(
  contactId: string,
  messageId: string | null
): UseQueryResult<IpcOutput<'messages.workDiff'>> {
  return useQuery({
    queryKey: ['diff', 'work', contactId, messageId] as const,
    queryFn: () =>
      callProcedure('messages.workDiff', { contactId, messageId: messageId as string }),
    enabled: messageId !== null,
    // A work diff's committed half is immutable, but its live half is read off
    // the moving tree — refetch when the dialog reopens rather than caching.
    staleTime: 0
  })
}

export function useCommitBranch(): {
  commit: (
    input: { repoPath: string; branch: string; message: string },
    onDone?: (committedSha: string) => void
  ) => void
  isPending: boolean
  error: string | null
  reset: () => void
} {
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: (input: { repoPath: string; branch: string; message: string }) =>
      callProcedure('branches.commit', input),
    onSuccess: () => {
      // The commit moved work from dirtyFiles into files on every summary, and
      // the branch diff now includes it.
      void queryClient.invalidateQueries({ queryKey: branchesKey })
      void queryClient.invalidateQueries({ queryKey: ['diff'] })
    }
  })

  return {
    commit: (input, onDone) =>
      mutation.mutate(input, { onSuccess: (result) => onDone?.(result.committedSha) }),
    isPending: mutation.isPending,
    error: mutation.error ? ipcErrorMessage(mutation.error) : null,
    reset: mutation.reset
  }
}

/** Fire-and-forget, like openExternal: refusal means nothing opens. */
export function openLocalPath(path: string): void {
  void callProcedure('shell.openPath', { path })
}

export function revealLocalPath(path: string): void {
  void callProcedure('shell.revealPath', { path })
}
