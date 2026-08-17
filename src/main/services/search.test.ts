import { beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { createTestDb } from '../db/test-db'
import { contacts, groupMessages, groups, messages, personaTemplates } from '../db/schema'
import type { AppDatabase } from '../db/create'

/**
 * Runs against the real 0017 migration — virtual tables, triggers, backfill —
 * because the claims here are about what SQLite actually does, not what the
 * service wishes it did. The cascade case in particular executes the one
 * assumption the trigger design leans on.
 */

let db: AppDatabase
vi.mock('../db', () => ({ initDb: () => db }))

const { buildMatchQuery, searchMessages } = await import('./search')

let rowCounter = 0
function seedMessage(contactId: string, content: string): string {
  rowCounter += 1
  const id = `m-${rowCounter}`
  db.insert(messages)
    .values({ id, contactId, role: 'user', content, timestamp: new Date(), work: null })
    .run()
  return id
}

function seedGroupMessage(groupId: string, content: string): string {
  rowCounter += 1
  const id = `gm-${rowCounter}`
  db.insert(groupMessages)
    .values({
      id,
      groupId,
      timestamp: new Date(),
      type: 'agent_reply',
      contactId: null,
      content,
      category: null,
      durable: null,
      branch: null
    })
    .run()
  return id
}

beforeEach(() => {
  db = createTestDb()
  rowCounter = 0
  db.insert(personaTemplates)
    .values({
      id: 'persona-1',
      name: 'Reviewer',
      avatarColor: '#2a78d6',
      backend: 'claude',
      systemPrompt: 'Review.',
      skillIds: [],
      sandbox: 'read_only',
      githubScope: 'read_only'
    })
    .run()
  db.insert(contacts)
    .values({
      id: 'contact-a',
      personaTemplateId: 'persona-1',
      repoPath: '/repo',
      displayName: 'Reviewer',
      backendSessionId: null
    })
    .run()
  db.insert(groups).values({ id: 'group-1', repoPath: '/repo' }).run()
})

describe('searchMessages', () => {
  it('finds a message and marks the matched tokens in the snippet', () => {
    const id = seedMessage('contact-a', 'The token cache lives in auth.ts, not the keychain.')
    seedMessage('contact-a', 'Unrelated chatter about lunch.')

    const results = searchMessages('token cache')

    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({ kind: 'message', contactId: 'contact-a', messageId: id })
    expect(results[0].snippet).toContain('\u0001token\u0002')
    expect(results[0].snippet).toContain('\u0001cache\u0002')
  })

  it('finds group rows and tags them as such', () => {
    const id = seedGroupMessage('group-1', 'Merged the worktree isolation branch.')

    const results = searchMessages('worktree isolation')

    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({
      kind: 'group_message',
      groupId: 'group-1',
      groupMessageId: id
    })
  })

  // The one assumption the trigger design leans on, executed rather than
  // believed: deleting a contact cascades its messages away inside SQLite,
  // never passing through insertMessage — the delete triggers must fire for
  // the cascade too, or the index serves ghosts.
  it('drops index entries when a contact deletion cascades its messages', () => {
    seedMessage('contact-a', 'ghost hunting expedition notes')
    expect(searchMessages('ghost hunting')).toHaveLength(1)

    db.delete(contacts).where(eq(contacts.id, 'contact-a')).run()

    expect(searchMessages('ghost hunting')).toEqual([])
  })

  it('treats FTS5 syntax in the query as text, never as an error', () => {
    seedMessage('contact-a', 'plain content')

    for (const hostile of ['a -b (c', 'NEAR(x', '"unclosed', 'col:val', '*star', 'a AND b']) {
      expect(() => searchMessages(hostile)).not.toThrow()
    }
    // And quoting is not just failure-avoidance — quoted operators match
    // their literal text.
    seedMessage('contact-a', 'use AND carefully')
    expect(searchMessages('use AND')).toHaveLength(1)
  })

  it('prefix-matches the final term for as-you-type search', () => {
    seedMessage('contact-a', 'refactor the worktrees module')

    expect(searchMessages('workt')).toHaveLength(1)
    // Only the last term is a prefix: an earlier partial word is a different
    // query, not a match.
    expect(searchMessages('workt module')).toEqual([])
    expect(searchMessages('module workt')).toHaveLength(1)
  })

  it('respects the limit across both sources', () => {
    for (let i = 0; i < 4; i += 1) seedMessage('contact-a', `shared needle number ${i}`)
    for (let i = 0; i < 4; i += 1) seedGroupMessage('group-1', `shared needle again ${i}`)

    expect(searchMessages('needle', 5)).toHaveLength(5)
  })

  it('returns nothing for queries under two characters', () => {
    seedMessage('contact-a', 'a single letter should not match this')

    expect(searchMessages('a')).toEqual([])
    expect(searchMessages(' ')).toEqual([])
    expect(searchMessages('')).toEqual([])
  })
})

describe('buildMatchQuery', () => {
  it('quotes every term and prefixes only the last', () => {
    expect(buildMatchQuery('token cache')).toBe('"token" "cache"*')
  })

  it('doubles embedded quotes', () => {
    expect(buildMatchQuery('say "hi"')).toBe('"say" """hi"""*')
  })

  it('is null for whitespace', () => {
    expect(buildMatchQuery('   ')).toBeNull()
  })
})
