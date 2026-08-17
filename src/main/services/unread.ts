import { and, count, gt, isNotNull, ne, eq } from 'drizzle-orm'
import { initDb } from '../db'
import { contacts, groupMessages, groups, messages } from '../db/schema'

/**
 * Unread counts (Phase 20, review §C4) — the app's first SQL aggregation.
 *
 * In a service over the real schema rather than renderer arithmetic, because
 * the renderer only holds previews (the last row per conversation), which can
 * say *that* something is unread but never *how many* — and shipping every
 * message row across IPC to count them would be the N+1 this app keeps
 * refusing.
 *
 * What counts as unread: rows strictly after the conversation's lastReadAt
 * (the boundary itself is read — it was stamped while the thread was on
 * screen), excluding what the user wrote (`role = 'user'` in 1:1s, the
 * `user_mention` type in groups: your own words are never news to you). A null
 * lastReadAt reads as everything-read, matching the column's contract.
 *
 * Both queries ride existing indexes: (contact_id, timestamp) on messages and
 * (group_id, timestamp) on group_messages.
 */

export interface UnreadCount {
  kind: 'contact' | 'group'
  id: string
  count: number
}

export function unreadCounts(): UnreadCount[] {
  const db = initDb()

  const contactRows = db
    .select({ id: contacts.id, unread: count() })
    .from(messages)
    .innerJoin(contacts, eq(messages.contactId, contacts.id))
    .where(
      and(
        eq(messages.role, 'assistant'),
        isNotNull(contacts.lastReadAt),
        gt(messages.timestamp, contacts.lastReadAt)
      )
    )
    .groupBy(contacts.id)
    .all()

  const groupRows = db
    .select({ id: groups.id, unread: count() })
    .from(groupMessages)
    .innerJoin(groups, eq(groupMessages.groupId, groups.id))
    .where(
      and(
        ne(groupMessages.type, 'user_mention'),
        isNotNull(groups.lastReadAt),
        gt(groupMessages.timestamp, groups.lastReadAt)
      )
    )
    .groupBy(groups.id)
    .all()

  return [
    ...contactRows.map((row) => ({ kind: 'contact' as const, id: row.id, count: row.unread })),
    ...groupRows.map((row) => ({ kind: 'group' as const, id: row.id, count: row.unread }))
  ]
}

/** What the dock badge shows: every unread message, both kinds. */
export function totalUnread(): number {
  return unreadCounts().reduce((sum, row) => sum + row.count, 0)
}
