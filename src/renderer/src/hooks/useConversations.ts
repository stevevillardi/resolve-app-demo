import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { callProcedure } from '@/lib/ipc-client'
import type { Contact, Group } from '@/types'

/**
 * The two entities the Chats list is built from (Phase 4).
 *
 * Read-only here. Contacts are created by `NewContactFlow` in Phase 6, and a
 * Group is never created directly at all — main makes one implicitly the first
 * time a contact binds to a repo (blueprint §4).
 *
 * Both are empty until Phase 6, which is correct rather than a gap: a contact
 * points at a real local repo path, and nothing can invent one.
 */

export const contactsKey = ['contacts'] as const
export const groupsKey = ['groups'] as const

export function useContacts(): UseQueryResult<Contact[]> {
  return useQuery({
    queryKey: contactsKey,
    queryFn: () => callProcedure('contacts.list', undefined)
  })
}

export function useGroups(): UseQueryResult<Group[]> {
  return useQuery({
    queryKey: groupsKey,
    queryFn: () => callProcedure('groups.list', undefined)
  })
}
