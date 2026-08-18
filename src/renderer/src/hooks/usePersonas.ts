import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import { callProcedure, ipcErrorMessage } from '@/lib/ipc-client'
import type { PersonaTemplate, PersonaTemplateDraft } from '@/types'

/**
 * Persona template reads and writes (Phase 4).
 *
 * Note `remove` can legitimately fail: main refuses to delete a persona that
 * contacts are still bound to, and the thrown message names them. That error
 * is meant to be shown, not swallowed — hence `error` on the return.
 */

export const personasKey = ['personas'] as const

export function usePersonas(): UseQueryResult<PersonaTemplate[]> {
  return useQuery({
    queryKey: personasKey,
    queryFn: () => callProcedure('personas.list', undefined)
  })
}

export function useCreatePersona(): {
  create: (draft: PersonaTemplateDraft, onCreated?: (persona: PersonaTemplate) => void) => void
  isPending: boolean
  /**
   * Why a create was refused, in the wording main sent.
   *
   * Added with the quick-create dialog (§G4). `personas.create` can refuse at
   * the Zod boundary — `requireScopePairing` is the live case — and until now
   * this hook discarded the error, so the only caller was a blank draft that
   * cannot fail. A form that can be refused needs somewhere to say so.
   */
  error: string | null
} {
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: (draft: PersonaTemplateDraft) => callProcedure('personas.create', draft),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: personasKey })
  })

  return {
    create: (draft, onCreated) => mutation.mutate(draft, { onSuccess: onCreated }),
    isPending: mutation.isPending,
    error: mutation.error ? ipcErrorMessage(mutation.error) : null
  }
}

export function useUpdatePersona(): {
  save: (persona: PersonaTemplate) => void
  isPending: boolean
  error: string | null
} {
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: (persona: PersonaTemplate) => callProcedure('personas.update', persona),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: personasKey })
  })

  return {
    save: (persona) => mutation.mutate(persona),
    isPending: mutation.isPending,
    error: mutation.error ? ipcErrorMessage(mutation.error) : null
  }
}

export function useDeletePersona(): {
  remove: (id: string, onDeleted?: () => void) => void
  isPending: boolean
  error: string | null
  reset: () => void
} {
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: (id: string) => callProcedure('personas.delete', { id }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: personasKey })
  })

  return {
    remove: (id, onDeleted) => mutation.mutate(id, { onSuccess: onDeleted }),
    isPending: mutation.isPending,
    error: mutation.error ? ipcErrorMessage(mutation.error) : null,
    // The blocked-delete message stays on screen until the user acts again;
    // reset clears it once they have.
    reset: mutation.reset
  }
}
