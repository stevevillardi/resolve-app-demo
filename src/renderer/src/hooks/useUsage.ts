import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { callProcedure } from '@/lib/ipc-client'
import { usageKey } from './useMessages'
import type { UsageEvent } from '@/types'

/**
 * Per-turn spend (blueprint §4), real as of Phase 6.
 *
 * Omit the contact id for every event across the app — that is what the Phase
 * 10 dashboard wants. Invalidation is handled by useAgentStream when a turn
 * ends, since that is the only thing that creates one.
 */
export function useUsageEvents(contactId?: string): UseQueryResult<UsageEvent[]> {
  return useQuery({
    queryKey: usageKey(contactId),
    queryFn: () => callProcedure('usage.list', contactId ? { contactId } : {})
  })
}
