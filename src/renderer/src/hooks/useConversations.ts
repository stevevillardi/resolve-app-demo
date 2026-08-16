import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import { callProcedure, ipcErrorMessage } from '@/lib/ipc-client'
import type { Contact, ContactDraft, Group } from '@/types'

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

/**
 * Creates a contact bound to a repo (Phase 6).
 *
 * Invalidates groups as well as contacts: main creates the repo's Group in the
 * same transaction when this is the first contact bound there (blueprint §4),
 * so the sidebar would otherwise show the contact without its group until
 * something else refetched.
 */
export function useCreateContact(): {
  create: (draft: ContactDraft, onCreated?: (contact: Contact) => void) => void
  isPending: boolean
  error: string | null
} {
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: (draft: ContactDraft) => callProcedure('contacts.create', draft),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: contactsKey })
      void queryClient.invalidateQueries({ queryKey: groupsKey })
    }
  })

  return {
    create: (draft, onCreated) => mutation.mutate(draft, { onSuccess: onCreated }),
    isPending: mutation.isPending,
    error: mutation.error ? ipcErrorMessage(mutation.error) : null
  }
}
