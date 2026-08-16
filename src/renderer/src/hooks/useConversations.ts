import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import { callProcedure, ipcErrorMessage } from '@/lib/ipc-client'
import { branchesKey } from './useBranches'
import { messagePreviewsKey, runsKey, usageRootKey } from './useMessages'
import { routinesKey } from './useRoutines'
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

/**
 * Renames a contact. The display name is the only thing about a bound Contact
 * that can change — see `contacts.update` in the IPC contract for why the rest
 * cannot.
 */
export function useRenameContact(): {
  rename: (id: string, displayName: string, onDone?: () => void) => void
  isPending: boolean
  error: string | null
  reset: () => void
} {
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: ({ id, displayName }: { id: string; displayName: string }) =>
      callProcedure('contacts.update', { id, displayName }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: contactsKey })
      // The conversation list shows the persona's name rather than the
      // contact's, but the routine editor's "Runs as" picker and the command
      // palette both read displayName, and both are keyed elsewhere.
      void queryClient.invalidateQueries({ queryKey: routinesKey })
      void queryClient.invalidateQueries({ queryKey: branchesKey })
    }
  })

  return {
    rename: (id, displayName, onDone) =>
      mutation.mutate({ id, displayName }, { onSuccess: onDone }),
    isPending: mutation.isPending,
    error: mutation.error ? ipcErrorMessage(mutation.error) : null,
    reset: mutation.reset
  }
}

/**
 * Deletes a contact, its thread and its worktree.
 *
 * Invalidates well beyond contacts, because the cascade reaches further than
 * any other delete in the app: the FKs take the 1:1 thread and its routines,
 * the worktree removal changes the branch list, and `usage_events.contact_id`
 * is set null rather than cascaded — so the spend survives as an orphan row
 * that the dashboard has to re-read to attribute correctly.
 *
 * `discardUncommitted` is the caller saying it asked. Main refuses the first
 * attempt when the worktree is dirty, and that refusal is the authoritative
 * check — do not pre-empt it with a status read from here, which would only
 * disagree with main under a race.
 */
export function useDeleteContact(): {
  remove: (id: string, discardUncommitted: boolean, onDone?: () => void) => void
  isPending: boolean
  error: string | null
  reset: () => void
} {
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: ({ id, discardUncommitted }: { id: string; discardUncommitted: boolean }) =>
      callProcedure('contacts.delete', { id, discardUncommitted }),
    onSuccess: () => {
      for (const queryKey of [
        contactsKey,
        groupsKey,
        routinesKey,
        branchesKey,
        runsKey,
        messagePreviewsKey,
        usageRootKey
      ]) {
        void queryClient.invalidateQueries({ queryKey })
      }
    }
  })

  return {
    remove: (id, discardUncommitted, onDone) =>
      mutation.mutate({ id, discardUncommitted }, { onSuccess: onDone }),
    isPending: mutation.isPending,
    error: mutation.error ? ipcErrorMessage(mutation.error) : null,
    reset: mutation.reset
  }
}
