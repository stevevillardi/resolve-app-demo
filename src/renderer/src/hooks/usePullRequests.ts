import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import { callProcedure, ipcErrorMessage } from '@/lib/ipc-client'
import { branchesKey } from './useBranches'
import type { PrResult, PrState } from '../../../shared/ipc-contract'

export const pullRequestKey = (contactId: string): readonly unknown[] =>
  ['pull-request', contactId] as const

/**
 * Whether this Contact can open a pull request, and the one it already has.
 *
 * A network read, so it is deliberately not eager: it runs when a thread or a
 * branch is on screen and is refetched after opening one. Nothing is stored
 * locally — GitHub is the only thing that knows whether a PR is still open, and
 * a cached copy would go stale the moment somebody merged it in a browser.
 */
export function usePullRequestState(contactId: string | null): UseQueryResult<PrState> {
  return useQuery({
    queryKey: pullRequestKey(contactId ?? ''),
    queryFn: () => callProcedure('github.pullRequestState', { contactId: contactId as string }),
    enabled: contactId !== null,
    // The answer changes when somebody merges on github.com, which this app has
    // no way to hear about. Re-asking on focus is the cheap approximation.
    refetchOnWindowFocus: true
  })
}

export function useOpenPullRequest(): {
  open: (contactId: string, onOpened?: (result: PrResult) => void) => void
  isPending: boolean
  error: string | null
  reset: () => void
} {
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: (contactId: string) => callProcedure('github.openPullRequest', { contactId }),
    onSuccess: (_result, contactId) => {
      void queryClient.invalidateQueries({ queryKey: pullRequestKey(contactId) })
      // The Branches panel renders the same branch, and now has a PR to show
      // against it.
      void queryClient.invalidateQueries({ queryKey: branchesKey })
    }
  })

  return {
    open: (contactId, onOpened) => mutation.mutate(contactId, { onSuccess: onOpened }),
    isPending: mutation.isPending,
    error: mutation.error ? ipcErrorMessage(mutation.error) : null,
    reset: () => mutation.reset()
  }
}
