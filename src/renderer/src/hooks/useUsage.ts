import { useEffect } from 'react'
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import { callProcedure, onUsageChanged } from '@/lib/ipc-client'
import { usageKey, usageRootKey } from './useMessages'
import type { ContactUsageSummary, UsageEvent } from '@/types'

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

/**
 * What each Contact has spent, rolled up by SQL (Phase 25 §B1).
 *
 * What the two rails read instead of `useUsageEvents()`. They needed one figure
 * per conversation and were fetching the entire `usage_events` table to derive
 * it, then rescanning that table once per row — so the sidebar's cost of drawing
 * grew with every turn anyone had ever taken, on both axes at once.
 *
 * Keyed under the same `['usage']` root as the raw list, so the existing
 * `usage-changed` push and the prefix invalidation in `useAgentStream` refresh
 * both without a second subscription. The effect below is the same one
 * `useUsageEvents` carries and for the same reason: covering every consumer by
 * construction rather than by remembering.
 */
export function useUsageSummaries(): UseQueryResult<ContactUsageSummary[]> {
  const queryClient = useQueryClient()

  useEffect(
    () => onUsageChanged(() => void queryClient.invalidateQueries({ queryKey: usageRootKey })),
    [queryClient]
  )

  return useQuery({
    queryKey: [...usageRootKey, 'summaries'],
    queryFn: () => callProcedure('usage.summaries', undefined)
  })
}
