import { useEffect } from 'react'
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import { callProcedure, onUsageChanged } from '@/lib/ipc-client'
import { usageKey, usageRootKey } from './useMessages'
import type { UsageEvent } from '@/types'

/**
 * Per-turn spend.
 *
 * Omit the contact id for every event across the app — that is what the usage
 * dashboard reads.
 *
 * The subscription lives in the hook rather than in a component so that every
 * consumer is covered by construction. `useAgentStream` also invalidates usage
 * on `done`, but only for a run *this renderer started* and only while that
 * thread is mounted — neither of which a scheduled routine satisfies, so
 * watching the dashboard while a routine spent money showed a stale total.
 * `runs-changed` was no better a signal: compaction records a summary turn's
 * usage after the run is already over, so that push fires before the row
 * exists. Main announces the write itself instead, from recordUsage.
 */
export function useUsageEvents(contactId?: string): UseQueryResult<UsageEvent[]> {
  const queryClient = useQueryClient()

  useEffect(
    () => onUsageChanged(() => void queryClient.invalidateQueries({ queryKey: usageRootKey })),
    [queryClient]
  )

  return useQuery({
    queryKey: usageKey(contactId),
    queryFn: () => callProcedure('usage.list', contactId ? { contactId } : {})
  })
}
