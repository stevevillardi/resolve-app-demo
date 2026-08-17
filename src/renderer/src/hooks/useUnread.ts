import { useCallback, useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { callProcedure, onMessagesChanged } from '@/lib/ipc-client'
import { unreadByConversation, type UnreadCount } from '@/lib/unread'

export const unreadKey = ['unread'] as const

/**
 * Per-conversation unread counts, refetched whenever a message row is written
 * or a boundary is stamped — both travel messages-changed, so the badges, the
 * previews they sit beside, and the dock all move together.
 */
export function useUnread(): Map<string, number> {
  const queryClient = useQueryClient()

  useEffect(
    () => onMessagesChanged(() => void queryClient.invalidateQueries({ queryKey: unreadKey })),
    [queryClient]
  )

  const { data = [] } = useQuery<UnreadCount[]>({
    queryKey: unreadKey,
    queryFn: () => callProcedure('unread.counts', undefined)
  })

  return unreadByConversation(data)
}

export function useMarkRead(): {
  markContactRead: (id: string) => void
  markGroupRead: (id: string) => void
} {
  const queryClient = useQueryClient()
  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: unreadKey })
  }

  // The messages-changed push already invalidates too; this direct one just
  // spares the badge a round-trip's worth of staleness on the thread the user
  // is looking at.
  const contact = useMutation({
    mutationFn: (id: string) => callProcedure('contacts.markRead', { id }),
    onSuccess: invalidate
  })
  const group = useMutation({
    mutationFn: (id: string) => callProcedure('groups.markRead', { id }),
    onSuccess: invalidate
  })

  // useCallback over TanStack's stable mutate, so the mark-read effects in the
  // thread views can list these in their deps without re-firing every render.
  const { mutate: mutateContact } = contact
  const { mutate: mutateGroup } = group
  return {
    markContactRead: useCallback((id: string) => mutateContact(id), [mutateContact]),
    markGroupRead: useCallback((id: string) => mutateGroup(id), [mutateGroup])
  }
}
