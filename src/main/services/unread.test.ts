import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestDb } from '../db/test-db'
import { contacts, groupMessages, groups, messages, personaTemplates } from '../db/schema'
import type { AppDatabase } from '../db/create'

/**
 * The unread queries, against the real schema — the boundary comparison and
 * the exclusions are SQL, and a mocked database would leave both untested.
 */

let db: AppDatabase
vi.mock('../db', () => ({ initDb: () => db }))

const { totalUnread, unreadCounts } = await import('./unread')

const READ_AT = new Date('2026-08-17T09:00:00Z')
const BEFORE = new Date(READ_AT.getTime() - 60_000)
const AFTER = new Date(READ_AT.getTime() + 60_000)

let rowCount = 0

function seedContact(id: string, lastReadAt: Date | null): void {
  db.insert(contacts)
    .values({
      id,
      personaTemplateId: 'persona-1',
      repoPath: `/repo/${id}`,
      displayName: id,
      backendSessionId: null,
      lastReadAt
    })
    .run()
}

function message(contactId: string, role: 'user' | 'assistant', timestamp: Date): void {
  rowCount += 1
  db.insert(messages)
    .values({ id: `m-${rowCount}`, contactId, role, content: 'x', timestamp })
    .run()
}

function seedGroup(id: string, lastReadAt: Date | null): void {
  db.insert(groups)
    .values({ id, repoPath: `/repo/${id}`, lastReadAt })
    .run()
}

function groupRow(
  groupId: string,
  type: 'system_summary' | 'user_mention' | 'agent_reply' | 'routine_run',
  timestamp: Date
): void {
  rowCount += 1
  db.insert(groupMessages)
    .values({ id: `g-${rowCount}`, groupId, type, content: 'x', timestamp })
    .run()
}

beforeEach(() => {
  db = createTestDb()
  rowCount = 0
  db.insert(personaTemplates)
    .values({
      id: 'persona-1',
      name: 'Reviewer',
      avatarColor: '#2a78d6',
      backend: 'claude',
      systemPrompt: 'Review.',
      skillIds: [],
      sandbox: 'read_only',
      githubScope: 'read_only',
      model: null
    })
    .run()
})

describe('unreadCounts', () => {
  it('counts assistant rows after the boundary, per contact', () => {
    seedContact('c1', READ_AT)
    message('c1', 'assistant', BEFORE)
    message('c1', 'assistant', AFTER)
    message('c1', 'assistant', AFTER)

    expect(unreadCounts()).toEqual([{ kind: 'contact', id: 'c1', count: 2 }])
  })

  // Your own words are never news to you — a thread where the user typed last
  // must not badge itself.
  it('never counts what the user wrote', () => {
    seedContact('c1', READ_AT)
    message('c1', 'user', AFTER)

    expect(unreadCounts()).toEqual([])
  })

  // The boundary was stamped while the thread was on screen, so the row that
  // carried it is read; strictly-after is what keeps a same-millisecond reply
  // from badging a thread the user is looking at.
  it('treats a row exactly at the boundary as read', () => {
    seedContact('c1', READ_AT)
    message('c1', 'assistant', READ_AT)

    expect(unreadCounts()).toEqual([])
  })

  it('reads a null boundary as everything read', () => {
    seedContact('c1', null)
    message('c1', 'assistant', AFTER)

    expect(unreadCounts()).toEqual([])
  })

  it('excludes user_mention rows from group counts, and nothing else', () => {
    seedGroup('g1', READ_AT)
    groupRow('g1', 'user_mention', AFTER)
    groupRow('g1', 'agent_reply', AFTER)
    groupRow('g1', 'routine_run', AFTER)
    groupRow('g1', 'system_summary', AFTER)

    expect(unreadCounts()).toEqual([{ kind: 'group', id: 'g1', count: 3 }])
  })

  it('keeps conversations independent', () => {
    seedContact('c1', READ_AT)
    seedContact('c2', READ_AT)
    message('c1', 'assistant', AFTER)

    expect(unreadCounts()).toEqual([{ kind: 'contact', id: 'c1', count: 1 }])
  })
})

describe('totalUnread', () => {
  it('sums both kinds for the dock badge', () => {
    seedContact('c1', READ_AT)
    seedGroup('g1', READ_AT)
    message('c1', 'assistant', AFTER)
    groupRow('g1', 'routine_run', AFTER)
    groupRow('g1', 'agent_reply', AFTER)

    expect(totalUnread()).toBe(3)
  })

  it('is zero on a fully-read profile', () => {
    seedContact('c1', READ_AT)
    message('c1', 'assistant', BEFORE)
    expect(totalUnread()).toBe(0)
  })
})
