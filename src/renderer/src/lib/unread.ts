import type { PersistedMessage, GroupMessage } from '@/types'

/**
 * Unread presentation logic. Pure and in lib/ for the usual reason: the
 * renderer Vitest project matches `*.test.ts` only, and the
 * badge cap and divider placement are exactly the kind of off-by-one that
 * looks right in a screenshot and is wrong at the boundary.
 */

export interface UnreadCount {
  kind: 'contact' | 'group'
  id: string
  count: number
}

/** `kind:id` keyed lookup for the sidebar — one map probe per row render. */
export function unreadByConversation(counts: UnreadCount[]): Map<string, number> {
  return new Map(counts.map((row) => [`${row.kind}:${row.id}`, row.count]))
}

/**
 * Two digits and a cap. Past 99 the number stops informing — "a lot" is the
 * message — and a four-digit pill would stretch every row for one outlier.
 */
export function formatBadge(count: number): string {
  return count > 99 ? '99+' : String(count)
}

/**
 * Where the "New messages" divider goes: the index of the first row after the
 * boundary that is not the user's own, or -1 for nowhere.
 *
 * Takes the boundary as it was when the thread opened, not the live value —
 * the mark-read effect stamps `lastReadAt` forward on mount, and a divider
 * computed against the live value would vanish in the same frame it appeared.
 */
export function firstUnreadIndex(
  rows: { timestamp: number; role?: PersistedMessage['role']; type?: GroupMessage['type'] }[],
  lastReadAtAtOpen: number | null
): number {
  if (lastReadAtAtOpen === null) return -1
  return rows.findIndex(
    (row) => row.timestamp > lastReadAtAtOpen && row.role !== 'user' && row.type !== 'user_mention'
  )
}
