import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestDb } from '../db/test-db'
import { groups, personaTemplates } from '../db/schema'
import type { AppDatabase } from '../db/create'

/**
 * The invariant under test is blueprint §4's "one Group per repo". A Contact
 * is the only thing that creates a Group, so it has to hold from the very
 * first contact bound to a path — not be reconciled later.
 */

let db: AppDatabase

vi.mock('../db', () => ({ initDb: () => db }))

const { createContact, getContact, listContacts } = await import('./contacts')
const { ensureGroupForRepo, listGroups } = await import('./groups')

const PERSONA_ID = 'persona-1'

function draft(
  repoPath: string,
  displayName: string
): {
  personaTemplateId: string
  repoPath: string
  displayName: string
} {
  return { personaTemplateId: PERSONA_ID, repoPath, displayName }
}

beforeEach(() => {
  db = createTestDb()
  db.insert(personaTemplates)
    .values({
      id: PERSONA_ID,
      name: 'Code Reviewer',
      avatarColor: '#2a78d6',
      backend: 'claude',
      systemPrompt: '',
      skillIds: [],
      sandbox: 'read_only',
      githubScope: 'read_only'
    })
    .run()
})

describe('create', () => {
  it('mints an id and starts with no session', () => {
    // §4: backendSessionId is a resume key, and there is nothing to resume
    // until a turn has actually run (Phase 6).
    const contact = createContact(draft('~/code/app', 'Code Reviewer · app'))
    expect(contact.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(contact.backendSessionId).toBeNull()
  })

  it('round-trips through the database', () => {
    const contact = createContact(draft('~/code/app', 'Code Reviewer · app'))
    expect(getContact(contact.id)).toEqual(contact)
  })

  it('returns null for an unknown id', () => {
    expect(getContact('nope')).toBeNull()
  })

  it('lists alphabetically by display name', () => {
    createContact(draft('~/code/z', 'Zebra'))
    createContact(draft('~/code/a', 'Alpha'))
    expect(listContacts().map((c) => c.displayName)).toEqual(['Alpha', 'Zebra'])
  })

  it('refuses a contact bound to a persona that does not exist', () => {
    // The foreign key is what stops an orphaned contact from being created.
    expect(() =>
      createContact({
        personaTemplateId: 'no-such-persona',
        repoPath: '~/code/app',
        displayName: 'Orphan'
      })
    ).toThrow()
  })
})

describe('group auto-creation', () => {
  it('creates the repo group on the first contact bound there', () => {
    expect(listGroups()).toEqual([])
    createContact(draft('~/code/app', 'Code Reviewer · app'))
    expect(listGroups().map((g) => g.repoPath)).toEqual(['~/code/app'])
  })

  it('reuses the existing group for a second contact on the same repo', () => {
    createContact(draft('~/code/app', 'Code Reviewer · app'))
    const before = listGroups()[0]
    createContact(draft('~/code/app', 'Docs Writer · app'))

    const after = listGroups()
    expect(after).toHaveLength(1)
    expect(after[0].id).toBe(before.id)
  })

  it('creates a separate group per repo', () => {
    createContact(draft('~/code/app', 'Code Reviewer · app'))
    createContact(draft('~/code/site', 'Code Reviewer · site'))
    expect(listGroups().map((g) => g.repoPath)).toEqual(['~/code/app', '~/code/site'])
  })

  it('leaves no group behind when the contact insert fails', () => {
    // Both writes are in one transaction, so a rejected contact must not
    // leave an orphan group for a repo nothing is bound to.
    expect(() =>
      createContact({
        personaTemplateId: 'no-such-persona',
        repoPath: '~/code/ghost',
        displayName: 'Ghost'
      })
    ).toThrow()
    expect(listGroups()).toEqual([])
  })
})

describe('ensureGroupForRepo', () => {
  it('is idempotent', () => {
    const first = ensureGroupForRepo('~/code/app')
    const second = ensureGroupForRepo('~/code/app')
    expect(second).toEqual(first)
    expect(listGroups()).toHaveLength(1)
  })

  it('is guarded by a unique index, not just by the check', () => {
    // A duplicate slipping past ensureGroupForRepo would break §4's
    // one-group-per-repo rule everywhere downstream.
    ensureGroupForRepo('~/code/app')
    expect(() => db.insert(groups).values({ id: 'dupe', repoPath: '~/code/app' }).run()).toThrow()
  })
})
