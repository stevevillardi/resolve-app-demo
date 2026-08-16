import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import { callProcedure, ipcErrorMessage } from '@/lib/ipc-client'
import { personasKey } from './usePersonas'
import type { Skill, SkillDraft } from '@/types'

/**
 * Skill library reads and writes (Phase 4). The list is small and entirely
 * local, so there's no pagination and no staleness policy worth tuning —
 * mutations invalidate and the list refetches from SQLite in under a
 * millisecond.
 */

export const skillsKey = ['skills'] as const

export function useSkills(): UseQueryResult<Skill[]> {
  return useQuery({
    queryKey: skillsKey,
    queryFn: () => callProcedure('skills.list', undefined)
  })
}

export function useCreateSkill(): {
  create: (draft: SkillDraft, onCreated?: (skill: Skill) => void) => void
  isPending: boolean
} {
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: (draft: SkillDraft) => callProcedure('skills.create', draft),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: skillsKey })
  })

  return {
    create: (draft, onCreated) => mutation.mutate(draft, { onSuccess: onCreated }),
    isPending: mutation.isPending
  }
}

export function useUpdateSkill(): {
  save: (skill: Skill) => void
  isPending: boolean
  error: string | null
} {
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: (skill: Skill) => callProcedure('skills.update', skill),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: skillsKey })
  })

  return {
    save: (skill) => mutation.mutate(skill),
    isPending: mutation.isPending,
    error: mutation.error ? ipcErrorMessage(mutation.error) : null
  }
}

export function useDeleteSkill(): {
  remove: (id: string, onDeleted?: () => void) => void
  isPending: boolean
  error: string | null
} {
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: (id: string) => callProcedure('skills.delete', { id }),
    // Deleting a skill strips its id from every persona that referenced it, so
    // the persona list is stale too — invalidating only `skills` would leave
    // the editor showing an attachment that no longer exists.
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: skillsKey })
      void queryClient.invalidateQueries({ queryKey: personasKey })
    }
  })

  return {
    remove: (id, onDeleted) => mutation.mutate(id, { onSuccess: onDeleted }),
    isPending: mutation.isPending,
    error: mutation.error ? ipcErrorMessage(mutation.error) : null
  }
}
