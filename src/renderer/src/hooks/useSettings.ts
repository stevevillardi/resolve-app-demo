import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import { callProcedure } from '@/lib/ipc-client'
import type { IpcOutput } from '../../../shared/ipc-contract'

export const workspaceRootKey = ['workspace', 'root'] as const

export function useWorkspaceRoot(): UseQueryResult<IpcOutput<'workspace.getRoot'>> {
  return useQuery({
    queryKey: workspaceRootKey,
    queryFn: () => callProcedure('workspace.getRoot', undefined)
  })
}

/** Opens the native picker; a cancel changes nothing, including the cache. */
export function useChooseWorkspaceRoot(): { choose: () => void; isPending: boolean } {
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: () => callProcedure('workspace.chooseRoot', undefined),
    onSuccess: (result) => {
      if (result.path === null) return
      queryClient.setQueryData(workspaceRootKey, { path: result.path, exists: true })
    }
  })
  return { choose: () => mutation.mutate(), isPending: mutation.isPending }
}

export function useAppInfo(): UseQueryResult<IpcOutput<'appInfo.get'>> {
  return useQuery({
    queryKey: ['appInfo'] as const,
    queryFn: () => callProcedure('appInfo.get', undefined),
    // A version does not change mid-process.
    staleTime: Infinity
  })
}
