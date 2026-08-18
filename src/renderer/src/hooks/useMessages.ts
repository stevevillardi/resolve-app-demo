import { useEffect } from 'react'
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import {
  callProcedure,
  ipcErrorMessage,
  onAgentEvent,
  onMessagesChanged,
  onRunsChanged
} from '@/lib/ipc-client'
import { useRunStore } from '@/store/useRunStore'
import { contactsKey } from './useConversations'
import type { PersistedMessage } from '@/types'
import type { ActiveRun, IpcOutput } from '../../../shared/ipc-contract'

/**
 * Thread reads and the send/stop pair (Phase 6).
 *
 * A send is unusual for this app in that the mutation resolving means the turn
 * *started*, not that it finished. The reply arrives on the push channel, is
 * folded into useRunStore, and is only refetched from SQLite once `done`
 * lands — so the query cache stays the single source of finished truth and the
 * store holds only what is still in flight.
 */

export type PersistedToolCall = IpcOutput<'messages.toolCalls'>[number]

export const messagesKey = (contactId: string): readonly unknown[] => ['messages', contactId]
export const messagePreviewsKey = ['messages', 'previews'] as const
export const usageKey = (contactId?: string): readonly unknown[] => ['usage', contactId ?? 'all']
/**
 * Prefix covering every usage cache entry — the all-events one the dashboard
 * reads and the per-contact one each thread reads. Invalidating the prefix
 * refreshes them together, which is exactly what a `usage-changed` push wants:
 * it says a row was written, not whose.
 */
export const usageRootKey = ['usage'] as const
export const runsKey = ['runs'] as const
/**
 * Prefix for every group thread's cache entry. Lives here rather than in
 * useGroupMessages so that invalidating it from the 1:1 stream does not make
 * this module depend on that one — a 1:1 turn writes a Group summary too.
 */
export const groupMessagesRootKey = ['groupMessages'] as const

export function useMessages(contactId: string): UseQueryResult<PersistedMessage[]> {
  return useQuery({
    queryKey: messagesKey(contactId),
    queryFn: () => callProcedure('messages.list', { contactId })
  })
}

export function useMessagePreviews(): UseQueryResult<PersistedMessage[]> {
  const queryClient = useQueryClient()

  // Messages written by background runs — a routine, a reply landing on a
  // thread nobody has open — reach no runId subscription, so before this push
  // the sidebar's preview (and everything else derived from message rows) only
  // refreshed by accident. Group previews ride the same signal: a group row is
  // a message row.
  useEffect(
    () =>
      onMessagesChanged(() => {
        void queryClient.invalidateQueries({ queryKey: messagePreviewsKey })
        void queryClient.invalidateQueries({ queryKey: groupMessagesRootKey })
      }),
    [queryClient]
  )

  return useQuery({
    queryKey: messagePreviewsKey,
    queryFn: () => callProcedure('messages.previews', undefined)
  })
}

/**
 * Subscribes the active thread to its own turn.
 *
 * Keyed on the runId so a stale subscription cannot write into a newer turn —
 * the unsubscribe returned by the effect is what guarantees that, since preload
 * filters by runId but a component that re-rendered mid-turn would otherwise
 * hold two listeners.
 */
export function useAgentStream(contactId: string): void {
  const queryClient = useQueryClient()
  const runId = useRunStore((state) => state.byContact[contactId]?.runId)
  const apply = useRunStore((state) => state.apply)
  const end = useRunStore((state) => state.end)

  useEffect(() => {
    if (!runId) return

    return onAgentEvent(runId, (event) => {
      apply(contactId, event)
      if (event.type !== 'done') return

      // The rows are already written — main holds `done` back until they are —
      // so this refetch cannot race the turn it is reacting to.
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: messagesKey(contactId) }),
        queryClient.invalidateQueries({ queryKey: messagePreviewsKey }),
        queryClient.invalidateQueries({ queryKey: usageKey(contactId) }),
        queryClient.invalidateQueries({ queryKey: usageKey() }),
        queryClient.invalidateQueries({ queryKey: contactsKey }),
        // Prefix-matched, so it refreshes every group thread rather than only
        // the one this turn was started from. A turn always writes to at most
        // one group, but the caller does not know which, and an @mentioned
        // reply that is not invalidated here shows in the live bubble and then
        // vanishes when end() clears the store.
        queryClient.invalidateQueries({ queryKey: groupMessagesRootKey })
      ]).then(() => end(contactId))
    })
  }, [runId, contactId, apply, end, queryClient])
}

export function useSendMessage(contactId: string): {
  send: (content: string, opts?: { onSuccess?: () => void }) => void
  isPending: boolean
  error: string | null
  reset: () => void
} {
  const queryClient = useQueryClient()
  const begin = useRunStore((state) => state.begin)

  const mutation = useMutation({
    mutationFn: (content: string) => callProcedure('messages.send', { contactId, content }),
    onSuccess: ({ runId }) => {
      begin(contactId, runId)
      void queryClient.invalidateQueries({ queryKey: messagesKey(contactId) })
    }
  })

  return {
    // The per-call onSuccess is how the composer's draft gets cleared only
    // once main accepted the turn — a lock refusal rejects, and the draft
    // has to survive it (review §B2).
    send: (content, opts) =>
      mutation.mutate(content, opts?.onSuccess ? { onSuccess: opts.onSuccess } : {}),
    isPending: mutation.isPending,
    // Carries the lock refusal naming whichever persona holds the repo, so the
    // composer can say who to wait for.
    error: mutation.error ? ipcErrorMessage(mutation.error) : null,
    reset: () => mutation.reset()
  }
}

/**
 * Re-runs an unanswered tail message via messages.retry.
 *
 * Takes the contact per call rather than per hook because the group thread
 * computes its retry target at render time — whichever member's thread holds
 * the unanswered row (lib/turn-tail.ts) — and a hook keyed to one contact
 * could not follow that.
 */
export function useRetryTurn(): {
  retry: (contactId: string, groupId?: string) => void
  error: string | null
  reset: () => void
} {
  const queryClient = useQueryClient()
  const begin = useRunStore((state) => state.begin)

  const mutation = useMutation({
    mutationFn: ({ contactId, groupId }: { contactId: string; groupId?: string }) =>
      callProcedure('messages.retry', { contactId, ...(groupId ? { groupId } : {}) }),
    onSuccess: ({ runId }, { contactId }) => {
      begin(contactId, runId)
      void queryClient.invalidateQueries({ queryKey: messagesKey(contactId) })
    }
  })

  return {
    retry: (contactId, groupId) => mutation.mutate({ contactId, ...(groupId ? { groupId } : {}) }),
    // A refused retry carries the same lock wording as a refused send.
    error: mutation.error ? ipcErrorMessage(mutation.error) : null,
    reset: () => mutation.reset()
  }
}

/**
 * Answers a pending ask (Phase 24). Refetches `runs.list` on settle either
 * way: a resolved ask removes the card, and a stale click (`resolved: false`)
 * means the list already changed under us — the refetch is the correction in
 * both cases, so there is no error state to render.
 */
export function useResolveApproval(): {
  resolve: (runId: string, approvalId: string, approved: boolean) => void
  isPending: boolean
} {
  const queryClient = useQueryClient()

  const mutation = useMutation({
    mutationFn: (input: { runId: string; approvalId: string; approved: boolean }) =>
      callProcedure('runs.resolveApproval', input),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: runsKey })
  })

  return {
    resolve: (runId, approvalId, approved) => mutation.mutate({ runId, approvalId, approved }),
    isPending: mutation.isPending
  }
}

export function useCancelRun(): { cancel: (runId: string) => void } {
  const mutation = useMutation({
    mutationFn: (runId: string) => callProcedure('messages.cancel', { runId })
  })
  return { cancel: (runId) => mutation.mutate(runId) }
}

/**
 * Every turn running anywhere, refetched whenever main says the set changed.
 *
 * The whole set rather than this contact's, because what disables a composer is
 * a turn on a *sibling* contact bound to the same repo (blueprint §15D).
 */
/**
 * The persisted tool record for a thread (Phase 17). Keyed under the thread's
 * messages key, so the invalidation a finished turn already does refetches
 * this too — no second wiring to forget.
 */
export function useToolCalls(contactId: string): UseQueryResult<PersistedToolCall[]> {
  return useQuery({
    queryKey: [...messagesKey(contactId), 'toolCalls'] as const,
    queryFn: () => callProcedure('messages.toolCalls', { contactId })
  })
}

export function useActiveRuns(): UseQueryResult<ActiveRun[]> {
  const queryClient = useQueryClient()

  useEffect(
    () => onRunsChanged(() => void queryClient.invalidateQueries({ queryKey: runsKey })),
    [queryClient]
  )

  return useQuery({
    queryKey: runsKey,
    queryFn: () => callProcedure('runs.list', undefined)
  })
}
