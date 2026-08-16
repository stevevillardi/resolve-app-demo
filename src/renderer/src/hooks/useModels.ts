import { useQuery } from '@tanstack/react-query'
import { callProcedure } from '@/lib/ipc-client'
import { modelsKey } from './useRepos'
import type { PersonaBackend } from '@/types'

/**
 * The models a persona can be pointed at, for one backend.
 *
 * Comes from main rather than a copy in the renderer so there is one list to
 * keep dated (src/main/adapters/models.ts). It never changes while the app is
 * running, hence the infinite staleTime — switching the backend toggle back and
 * forth should not re-cross the IPC boundary.
 */
export function useModels(backend: PersonaBackend): string[] {
  const { data = [] } = useQuery({
    queryKey: modelsKey(backend),
    queryFn: () => callProcedure('models.listForBackend', { backend }),
    staleTime: Infinity
  })
  return data
}
