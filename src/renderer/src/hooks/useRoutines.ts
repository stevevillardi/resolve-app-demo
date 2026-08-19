import { useEffect } from 'react'
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import { callProcedure, ipcErrorMessage, onRoutinesChanged } from '@/lib/ipc-client'
import { useRunStore } from '@/store/useRunStore'
import { runsKey } from './useMessages'
import type { Routine, RoutineDraft, RoutineUpdate } from '@/types'

export const routinesKey = ['routines'] as const

export function useRoutines(): UseQueryResult<Routine[]> {
  const queryClient = useQueryClient()

  // The push half (Phase 20). Mutations invalidate on their own, but a routine
  // *firing* is main acting alone — before this subscription, a 3 a.m. run's
  // outcome (and any recorded miss) sat stale until the next window focus.
  // The prefix covers nextRuns too, since a fire moves the next fire time.
  useEffect(
    () => onRoutinesChanged(() => void queryClient.invalidateQueries({ queryKey: routinesKey })),
    [queryClient]
  )

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
  const begin = useRunStore((state) => state.begin)
  const mutation = useMutation({
    mutationFn: (id: string) => callProcedure('routines.runNow', { id }),
    // The turn only just *started* — its run history lands minutes later, when
    // the scheduler writes it. Entering the run store here is what makes the
    // start visible NOW: the live bubble, the busy composer, and the Routines
    // pane's running state all key off it, deterministically rather than via
    // the push round-trip the reconciliation sweep would eventually take.
    onSuccess: (result) => {
      if (result.runId && result.contactId) begin(result.contactId, result.runId)
      void queryClient.invalidateQueries({ queryKey: routinesKey })
      void queryClient.invalidateQueries({ queryKey: runsKey })
    }
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

export interface NextRunRow {
  routineId: string
  prompt: string
  contactName: string | null
  nextRun: number | null
}

/**
 * The scheduler's next-fire view for Home. Refetched on window focus and
 * invalidated with routinesKey-adjacent mutations indirectly: fire times only
 * move when a schedule changes or a routine fires, both of which land back on
 * this screen through a refetch soon enough for a resting overview.
 */
export function useNextRuns(): UseQueryResult<NextRunRow[]> {
  return useQuery({
    queryKey: [...routinesKey, 'nextRuns'] as const,
    queryFn: () => callProcedure('routines.nextRuns', undefined),
    staleTime: 30_000,
    refetchOnWindowFocus: true
  })
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
