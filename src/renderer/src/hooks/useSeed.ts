import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import { callProcedure, ipcErrorMessage } from '@/lib/ipc-client'
import { personasKey } from './usePersonas'
import { skillsKey } from './useSkills'
import type { IpcOutput } from '../../../shared/ipc-contract'

export type SeedCatalog = IpcOutput<'seed.catalog'>

export const seedCatalogKey = ['seed', 'catalog'] as const

export function useSeedCatalog(): UseQueryResult<SeedCatalog> {
  return useQuery({
    queryKey: seedCatalogKey,
    queryFn: () => callProcedure('seed.catalog', undefined)
  })
}

export function useApplyStarterSelection(): {
  apply: (personaIds: string[], skillIds: string[], onDone?: () => void) => void
  isPending: boolean
  error: string | null
} {
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: (input: { personaIds: string[]; skillIds: string[] }) =>
      callProcedure('seed.applySelection', input),
    // The catalog's installed flags and both libraries just changed.
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: seedCatalogKey })
      void queryClient.invalidateQueries({ queryKey: personasKey })
      void queryClient.invalidateQueries({ queryKey: skillsKey })
    }
  })

  return {
    apply: (personaIds, skillIds, onDone) =>
      mutation.mutate({ personaIds, skillIds }, { onSuccess: onDone }),
    isPending: mutation.isPending,
    error: mutation.error ? ipcErrorMessage(mutation.error) : null
  }
}
