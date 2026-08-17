import { sql } from 'drizzle-orm'
import { initDb } from '../db'

/**
 * Message-content search over the FTS5 tables migration 0017 maintains
 * (review §B4). Until now a *conversation* could be found by name and a
 * *message* could not be found at all.
 *
 * The service owns query hygiene: raw user text goes into MATCH, and FTS5
 * treats `-`, `:`, parens and quotes as syntax — so every term is wrapped in
 * double quotes (embedded quotes doubled) and only the final term gets the
 * `*` that makes as-you-type prefix search work. A query that would throw is
 * therefore unrepresentable rather than caught.
 */

export interface MessageSearchResult {
  kind: 'message'
  contactId: string
  messageId: string
  snippet: string
  timestamp: number
}

export interface GroupMessageSearchResult {
  kind: 'group_message'
  groupId: string
  groupMessageId: string
  snippet: string
  timestamp: number
}

export type SearchResult = MessageSearchResult | GroupMessageSearchResult

/** Two characters before anything runs: one keystroke matches everything. */
const MIN_QUERY_LENGTH = 2

/**
 * How snippet() decorates the matched tokens; the renderer splits on these.
 * Control characters rather than anything printable, because message content
 * here is code-adjacent — brackets, angle quotes, and asterisks all occur
 * naturally, and a highlight marker that can appear in the text makes every
 * snippet ambiguous.
 */
export const SNIPPET_OPEN = '\u0001'
export const SNIPPET_CLOSE = '\u0002'

export function buildMatchQuery(raw: string): string | null {
  const terms = raw.trim().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return null

  return terms
    .map((term, index) => {
      const quoted = `"${term.replaceAll('"', '""')}"`
      return index === terms.length - 1 ? `${quoted}*` : quoted
    })
    .join(' ')
}

export function searchMessages(query: string, limit = 20): SearchResult[] {
  if (query.trim().length < MIN_QUERY_LENGTH) return []
  const match = buildMatchQuery(query)
  if (!match) return []

  const db = initDb()

  const messageRows = db.all<{
    messageId: string
    contactId: string
    timestamp: number
    snippet: string
    rank: number
  }>(sql`
    SELECT m.id AS messageId, m.contact_id AS contactId, m.timestamp AS timestamp,
           snippet(messages_fts, 0, ${SNIPPET_OPEN}, ${SNIPPET_CLOSE}, '…', 12) AS snippet,
           bm25(messages_fts) AS rank
    FROM messages_fts
    JOIN messages m ON m.rowid = messages_fts.rowid
    WHERE messages_fts MATCH ${match}
    ORDER BY rank
    LIMIT ${limit}
  `)

  const groupRows = db.all<{
    groupMessageId: string
    groupId: string
    timestamp: number
    snippet: string
    rank: number
  }>(sql`
    SELECT g.id AS groupMessageId, g.group_id AS groupId, g.timestamp AS timestamp,
           snippet(group_messages_fts, 0, ${SNIPPET_OPEN}, ${SNIPPET_CLOSE}, '…', 12) AS snippet,
           bm25(group_messages_fts) AS rank
    FROM group_messages_fts
    JOIN group_messages g ON g.rowid = group_messages_fts.rowid
    WHERE group_messages_fts MATCH ${match}
    ORDER BY rank
    LIMIT ${limit}
  `)

  // bm25 scores from two separate indexes are only roughly comparable, but
  // "roughly, then truncate" beats segregating the kinds into two lists the
  // palette would have to rank arbitrarily anyway.
  const combined: (SearchResult & { rank: number })[] = [
    ...messageRows.map((row) => ({
      kind: 'message' as const,
      contactId: row.contactId,
      messageId: row.messageId,
      snippet: row.snippet,
      timestamp: row.timestamp,
      rank: row.rank
    })),
    ...groupRows.map((row) => ({
      kind: 'group_message' as const,
      groupId: row.groupId,
      groupMessageId: row.groupMessageId,
      snippet: row.snippet,
      timestamp: row.timestamp,
      rank: row.rank
    }))
  ]
  combined.sort((a, b) => a.rank - b.rank)
  return combined.slice(0, limit).map((entry) => {
    const { rank, ...result } = entry
    void rank
    return result
  })
}
