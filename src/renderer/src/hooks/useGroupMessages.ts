import { useEffect } from 'react'
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import { callProcedure, ipcErrorMessage, onAgentEvent } from '@/lib/ipc-client'
import { useRunStore } from '@/store/useRunStore'
import { groupMessagesRootKey, messagesKey } from './useMessages'
import type { GroupMessage } from '@/types'

/**
 * The Group thread's reads and its @mention send (Phase 7, blueprint §6/§8).
 *
 * The thing worth understanding before editing: an @mention is not a separate
 * kind of turn. It runs against the mentioned Contact's real session, streams
 * on the same push channel, and is folded into the same contact-keyed
 * useRunStore — which is precisely why the reply renders identically in the
 * Group thread and in that Contact's 1:1 thread without any state being
 * duplicated. Nothing here introduces a group-keyed run.
 */

export const groupMessagesKey = (groupId: string): readonly unknown[] => [
  ...groupMessagesRootKey,
  groupId
]

export const groupMessagePreviewsKey = [...groupMessagesRootKey, 'previews'] as const

export function useGroupMessages(groupId: string): UseQueryResult<GroupMessage[]> {
  return useQuery({
    queryKey: groupMessagesKey(groupId),
    queryFn: () => callProcedure('groupMessages.list', { groupId })
  })
}

/** Latest message per group, for the conversation list's preview line. */
export function useGroupMessagePreviews(): UseQueryResult<GroupMessage[]> {
  return useQuery({
    queryKey: groupMessagePreviewsKey,
    queryFn: () => callProcedure('groupMessages.previews', undefined)
  })
}

/**
 * Subscribes several contacts' turns at once.
 *
 * `useAgentStream` is single-contact and cannot be called in a loop over a
 * dynamic array — hooks are positional. The Group thread needs all of its
 * members subscribed, because a reply can arrive there from any of them: an
 * @mention started here, or a 1:1 turn on a member that will post its summary
 * to this group.
 *
 * Deliberately one effect over the joined set rather than N hooks, so the
 * subscription list can change with the membership.
 */
export function useAgentStreams(contactIds: string[]): void {
  const queryClient = useQueryClient()
  const runs = useRunStore((state) => state.byContact)
  const apply = useRunStore((state) => state.apply)
  const end = useRunStore((state) => state.end)

  // Joined rather than passed as an array: a fresh array identity every render
  // would re-subscribe on every keystroke in the composer.
  const active = contactIds
    .map((id) => `${id}:${runs[id]?.runId ?? ''}`)
    .filter((entry) => !entry.endsWith(':'))
    .sort()
    .join(',')

  useEffect(() => {
    if (!active) return

    const unsubscribes = active.split(',').map((entry) => {
      const [contactId, runId] = entry.split(':')
      return onAgentEvent(runId, (event) => {
        apply(contactId, event)
        if (event.type !== 'done') return

        void Promise.all([
          queryClient.invalidateQueries({ queryKey: groupMessagesRootKey }),
          queryClient.invalidateQueries({ queryKey: messagesKey(contactId) })
        ]).then(() => end(contactId))
      })
    })

    return () => unsubscribes.forEach((unsubscribe) => unsubscribe())
  }, [active, apply, end, queryClient])
}

export function useMentionInGroup(groupId: string): {
  mention: (contactId: string, content: string, opts?: { onSuccess?: () => void }) => void
  isPending: boolean
  error: string | null
  reset: () => void
} {
  const queryClient = useQueryClient()
  const begin = useRunStore((state) => state.begin)

  const mutation = useMutation({
    mutationFn: ({ contactId, content }: { contactId: string; content: string }) =>
      callProcedure('groups.mention', { groupId, contactId, content }),
    onSuccess: ({ runId }, { contactId }) => {
      // Keyed by the *mentioned contact*, not by the group. That is what makes
      // the streaming reply appear in both threads from one piece of state.
      begin(contactId, runId)
      void queryClient.invalidateQueries({ queryKey: groupMessagesKey(groupId) })
    }
  })

  return {
    // Per-call onSuccess mirrors useSendMessage: the group composer clears its
    // draft only when the mention was accepted, so a refusal keeps the text.
    mention: (contactId, content, opts) =>
      mutation.mutate({ contactId, content }, opts?.onSuccess ? { onSuccess: opts.onSuccess } : {}),
    isPending: mutation.isPending,
    // Carries the lock refusal naming whichever persona holds the repo.
    error: mutation.error ? ipcErrorMessage(mutation.error) : null,
    reset: () => mutation.reset()
  }
}
