import { useQuery } from '@tanstack/react-query'
import { callProcedure } from '@/lib/ipc-client'

/**
 * The working tree's paths for @file autocomplete (review §B3).
 *
 * Gated on `enabled` — the thread views pass "the draft contains an @" —
 * because listing a repo spawns git, and an open thread is no reason to pay
 * for that. Same lazy-gating shape as useContactContext. staleTime keeps a
 * picker that reopens mid-conversation from re-spawning git every keystroke
 * while still following the agent's own writes within half a minute.
 */
export function useContactFiles(contactId: string, enabled: boolean): string[] {
  const { data } = useQuery({
    queryKey: ['contactFiles', contactId],
    queryFn: () => callProcedure('contacts.files', { contactId }),
    enabled,
    staleTime: 30_000
  })

  return enabled ? (data?.files ?? []) : []
}
