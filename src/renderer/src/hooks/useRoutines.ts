import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import { callProcedure, ipcErrorMessage } from '@/lib/ipc-client'
import type { Routine, RoutineDraft, RoutineUpdate } from '@/types'

export const routinesKey = ['routines'] as const

export function useRoutines(): UseQueryResult<Routine[]> {
  return useQuery({
    queryKey: routinesKey,
    queryFn: () => callProcedure('routines.list', undefined)
  })
}

export function useCreateRoutine(): {
  create: (draft: RoutineDraft, onCreated?: (routine: Routine) => void) => void
  isPending: boolean
  error: string | null
} {
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: (draft: RoutineDraft) => callProcedure('routines.create', draft),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: routinesKey })
  })

  return {
    create: (draft, onCreated) => mutation.mutate(draft, { onSuccess: onCreated }),
    isPending: mutation.isPending,
    error: mutation.error ? ipcErrorMessage(mutation.error) : null
  }
}

export function useUpdateRoutine(): {
  save: (routine: RoutineUpdate) => void
  isPending: boolean
  error: string | null
} {
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: (routine: RoutineUpdate) => callProcedure('routines.update', routine),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: routinesKey })
  })

  return {
    save: (routine) => mutation.mutate(routine),
    isPending: mutation.isPending,
    error: mutation.error ? ipcErrorMessage(mutation.error) : null
  }
}

export function useDeleteRoutine(): {
  remove: (id: string, onDeleted?: () => void) => void
  isPending: boolean
  error: string | null
} {
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: (id: string) => callProcedure('routines.delete', { id }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: routinesKey })
  })

  return {
    remove: (id, onDeleted) => mutation.mutate(id, { onSuccess: onDeleted }),
    isPending: mutation.isPending,
    error: mutation.error ? ipcErrorMessage(mutation.error) : null
  }
}

export function useRunRoutineNow(): {
  runNow: (id: string, onResult?: (result: { skipped: string | null }) => void) => void
  isPending: boolean
  /** The lock refusal, when a fire was skipped rather than started. */
  skipped: string | null
  error: string | null
} {
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: (id: string) => callProcedure('routines.runNow', { id }),
    // The turn only just *started* — its run history lands minutes later, when
    // the scheduler writes it. Invalidating here refreshes the skip case, which
    // is already decided; the completed case arrives with the next refetch.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: routinesKey })
  })

  return {
    // The callback exists for callers with no pane to show `skipped` in — the
    // routine row's context menu answers with a toast instead.
    runNow: (id, onResult) => mutation.mutate(id, { onSuccess: (result) => onResult?.(result) }),
    isPending: mutation.isPending,
    skipped: mutation.data?.skipped ?? null,
    error: mutation.error ? ipcErrorMessage(mutation.error) : null
  }
}

/**
 * Validates a cron expression in main, where node-cron lives.
 *
 * Keyed by the expression with `staleTime: Infinity`, so each distinct string
 * is validated exactly once ever — the round trip is per *new* expression, not
 * per keystroke.
 */
export function useCronValidation(schedule: string): {
  error: string | null
  nextRuns: number[]
  isPending: boolean
} {
  const trimmed = schedule.trim()
  const query = useQuery({
    queryKey: ['cron', trimmed] as const,
    queryFn: () => callProcedure('routines.validateSchedule', { schedule: trimmed }),
    enabled: trimmed.length > 0,
    staleTime: Infinity
  })

  return {
    error: query.data?.valid === false ? query.data.error : null,
    nextRuns: query.data?.nextRuns ?? [],
    isPending: query.isFetching
  }
}
