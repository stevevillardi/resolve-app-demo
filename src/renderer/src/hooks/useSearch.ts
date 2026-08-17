import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { callProcedure } from '@/lib/ipc-client'
import type { IpcOutput } from '../../../shared/ipc-contract'

export type MessageSearchResults = IpcOutput<'search.messages'>

/**
 * Message-content search for the ⌘K palette (review §B4).
 *
 * Enabled from two characters — the same floor the service enforces — and
 * kept on `keepPreviousData` so the Messages section holds steady while the
 * user types instead of flashing empty between keystrokes. No debounce: an
 * FTS5 query over local IPC is single-digit milliseconds at this scale.
 */
export function useSearchMessages(query: string): MessageSearchResults {
  const needle = query.trim()
  const enabled = needle.length >= 2

  const { data } = useQuery({
    queryKey: ['search', 'messages', needle],
    queryFn: () => callProcedure('search.messages', { query: needle }),
    enabled,
    placeholderData: keepPreviousData
  })

  // Below the floor the previous results are stale by definition — a cleared
  // input should clear the section, not hold the last query's hits.
  return enabled ? (data ?? []) : []
}
