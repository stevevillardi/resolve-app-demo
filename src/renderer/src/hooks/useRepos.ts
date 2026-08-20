import { useMutation, useQuery, type UseQueryResult } from '@tanstack/react-query'
import { callProcedure, ipcErrorMessage } from '@/lib/ipc-client'
import type { BoundRepo, RepoOption } from '../../../shared/ipc-contract'

/**
 * The two ways to bind a repo: browse GitHub, or point at a folder that is
 * already on disk.
 *
 * The GitHub list is only fetched when the picker asks for it — it is a network
 * round trip that most sessions never need, and fetching it on mount would make
 * opening the dialog feel slower than it is.
 */

export const reposKey = ['repos'] as const
export const modelsKey = (backend: string): readonly unknown[] => ['models', backend]

export function useRepos(enabled: boolean): UseQueryResult<RepoOption[]> {
  return useQuery({
    queryKey: reposKey,
    queryFn: () => callProcedure('repos.list', undefined),
    enabled,
    // Cloning one changes its localPath, and so does anything the user does in
    // a terminal. Short enough to stay honest, long enough that stepping back
    // and forth in the dialog doesn't refetch.
    staleTime: 30_000,
    // Not worth three attempts. The failures this actually sees are a rejected
    // token and a rate limit, and neither improves by being asked again — they
    // just delay the message that says what to do about it by several seconds.
    retry: false
  })
}

export function useChooseDirectory(): {
  choose: (onChosen: (repo: BoundRepo) => void) => void
  isPending: boolean
} {
  const mutation = useMutation({
    mutationFn: () => callProcedure('repos.chooseDirectory', undefined)
  })

  return {
    choose: (onChosen) =>
      mutation.mutate(undefined, {
        // Null is a cancelled dialog, which is an answer rather than a failure.
        onSuccess: (repo) => repo && onChosen(repo)
      }),
    isPending: mutation.isPending
  }
}

export function useCloneRepo(): {
  clone: (
    input: { fullName: string; cloneUrl: string },
    onCloned: (repo: BoundRepo) => void
  ) => void
  isPending: boolean
  error: string | null
} {
  const mutation = useMutation({
    mutationFn: (input: { fullName: string; cloneUrl: string }) =>
      callProcedure('repos.clone', input)
  })

  return {
    clone: (input, onCloned) =>
      mutation.mutate(input, { onSuccess: (repo) => repo && onCloned(repo) }),
    isPending: mutation.isPending,
    error: mutation.error ? ipcErrorMessage(mutation.error) : null
  }
}
