import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import { callProcedure, ipcErrorMessage } from '@/lib/ipc-client'
import { branchesKey } from './useBranches'
import { messagePreviewsKey, runsKey, usageRootKey } from './useMessages'
import { routinesKey } from './useRoutines'
import type { Contact, ContactDraft, Group, Isolation, RepoTrust } from '@/types'
import type { ContactContext, RepoOffers } from '../../../shared/ipc-contract'

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

/**
 * What a turn on this contact would inject (blueprint §5).
 *
 * `enabled` because this stats the filesystem for sibling branches in main —
 * cheap, but not free, and there is no reason to pay for it on every render of
 * a thread nobody has asked this question about.
 *
 * Not cached across opens: the spec is resolved per turn, so the honest answer
 * changes whenever a colleague writes a summary or opens a branch.
 */
export function useContactContext(
  contactId: string,
  enabled: boolean
): UseQueryResult<ContactContext | null> {
  return useQuery({
    queryKey: ['contacts', 'context', contactId],
    queryFn: () => callProcedure('contacts.context', { contactId }),
    enabled,
    staleTime: 0,
    gcTime: 0
  })
}

/**
 * What the repository is offering, approved or not — the list you choose from.
 *
 * A separate query from useContactContext because it answers a different
 * question. That one reports what a turn would send, which stays empty until
 * somebody opts in; this is how you find out there is anything to opt into.
 */
export function useRepoOffers(
  contactId: string,
  enabled: boolean
): UseQueryResult<RepoOffers | null> {
  return useQuery({
    queryKey: ['contacts', 'repoOffers', contactId],
    queryFn: () => callProcedure('contacts.repoOffers', { contactId }),
    enabled,
    // Read off the filesystem, so a skill committed while the app is open turns
    // up the next time the panel opens rather than after a restart.
    staleTime: 0,
    gcTime: 0
  })
}

/**
 * Grants or revokes what this contact's repository may say to it.
 *
 * Invalidates the context query as well as the contact list, because this is
 * the one mutation in the app that changes what the *next turn* will contain —
 * the panel showing that turn would otherwise keep describing the trust state
 * from before the click.
 */
export function useSetRepoTrust(): {
  set: (contactId: string, trust: RepoTrust) => void
  isPending: boolean
  error: string | null
} {
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: ({ contactId, trust }: { contactId: string; trust: RepoTrust }) =>
      callProcedure('contacts.setRepoTrust', { id: contactId, trust }),
    onSuccess: (_result, { contactId }) => {
      void queryClient.invalidateQueries({ queryKey: contactsKey })
      void queryClient.invalidateQueries({ queryKey: ['contacts', 'context', contactId] })
    }
  })

  return {
    set: (contactId, trust) => mutation.mutate({ contactId, trust }),
    isPending: mutation.isPending,
    error: mutation.error ? ipcErrorMessage(mutation.error) : null
  }
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
 * Moves a contact to another persona (Phase 17). Invalidates broadly: the
 * conversation list shows the persona's name and avatar, the routine editor's
 * "Runs as" rows show it too, and the context panel's whole answer changes.
 */
export function useRebindPersona(): {
  rebind: (id: string, personaTemplateId: string, onDone?: () => void) => void
  isPending: boolean
  error: string | null
} {
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: ({ id, personaTemplateId }: { id: string; personaTemplateId: string }) =>
      callProcedure('contacts.rebindPersona', { id, personaTemplateId }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: contactsKey })
      void queryClient.invalidateQueries({ queryKey: routinesKey })
    }
  })

  return {
    rebind: (id, personaTemplateId, onDone) =>
      mutation.mutate({ id, personaTemplateId }, { onSuccess: onDone }),
    isPending: mutation.isPending,
    error: mutation.error ? ipcErrorMessage(mutation.error) : null
  }
}

/**
 * Drops the backend's memory of the thread, and keeps the thread (Phase 22).
 *
 * Only `contactsKey` is invalidated, and that is the whole shape of the
 * feature: nothing about the messages, the routines or the spend has changed —
 * one column on one contact has. The thread still repaints, because
 * `backendSessionId` is what `awaitingFreshSession` reads.
 */
export function useStartFreshSession(): {
  startFresh: (id: string, onDone?: () => void) => void
  isPending: boolean
  error: string | null
} {
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: ({ id }: { id: string }) => callProcedure('contacts.startFreshSession', { id }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: contactsKey })
    }
  })

  return {
    startFresh: (id, onDone) => mutation.mutate({ id }, { onSuccess: onDone }),
    isPending: mutation.isPending,
    error: mutation.error ? ipcErrorMessage(mutation.error) : null
  }
}

/**
 * Replaces a contact and brings its conversation across (Phase 22).
 *
 * One mutation where the flow used to call create and then delete: the rows are
 * re-pointed between them, so a failure partway used to leave either two
 * contacts or a deleted thread.
 */
export function useRecreateContact(): {
  recreate: (
    input: {
      fromId: string
      draft: ContactDraft
      bringHistory: boolean
      discardUncommitted?: boolean
    },
    onDone?: (contact: Contact) => void
  ) => void
  isPending: boolean
  error: string | null
} {
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: (input: {
      fromId: string
      draft: ContactDraft
      bringHistory: boolean
      discardUncommitted?: boolean
    }) => callProcedure('contacts.recreate', input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: contactsKey })
      void queryClient.invalidateQueries({ queryKey: groupsKey })
      void queryClient.invalidateQueries({ queryKey: routinesKey })
      void queryClient.invalidateQueries({ queryKey: branchesKey })
      // The thread itself moved to a different contact id, so every cached
      // message list and preview is now filed under the wrong one.
      void queryClient.invalidateQueries({ queryKey: messagePreviewsKey })
      void queryClient.invalidateQueries({ queryKey: ['messages'] })
    }
  })

  return {
    recreate: (input, onDone) => mutation.mutate(input, { onSuccess: onDone }),
    isPending: mutation.isPending,
    error: mutation.error ? ipcErrorMessage(mutation.error) : null
  }
}

/**
 * Points a contact at its own model, or back at its persona's (Phase 22).
 *
 * Only the contact list is invalidated: nothing about the thread or the spend
 * has changed, and the model applies from the next turn.
 */
export function useSetContactModel(): {
  setModel: (id: string, model: string | null, onDone?: () => void) => void
  isPending: boolean
  error: string | null
} {
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: (input: { id: string; model: string | null }) =>
      callProcedure('contacts.setModel', input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: contactsKey })
    }
  })

  return {
    setModel: (id, model, onDone) => mutation.mutate({ id, model }, { onSuccess: onDone }),
    isPending: mutation.isPending,
    error: mutation.error ? ipcErrorMessage(mutation.error) : null
  }
}

/**
 * Moves a contact between your checkout and its own (Phase 22).
 *
 * Invalidates contacts and branches: de-isolating removes a checkout while
 * keeping the branch, so the Branches panel's view of what exists on disk has
 * genuinely changed.
 */
export function useSetIsolation(): {
  setIsolation: (
    id: string,
    isolation: Isolation,
    discardUncommitted: boolean,
    onDone?: () => void
  ) => void
  isPending: boolean
  error: string | null
} {
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: (input: { id: string; isolation: Isolation; discardUncommitted: boolean }) =>
      callProcedure('contacts.setIsolation', input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: contactsKey })
      void queryClient.invalidateQueries({ queryKey: branchesKey })
    }
  })

  return {
    setIsolation: (id, isolation, discardUncommitted, onDone) =>
      mutation.mutate({ id, isolation, discardUncommitted }, { onSuccess: onDone }),
    isPending: mutation.isPending,
    error: mutation.error ? ipcErrorMessage(mutation.error) : null
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
