import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestDb } from '../db/test-db'
import { contacts, personaTemplates } from '../db/schema'
import type { AppDatabase } from '../db/create'

let db: AppDatabase

vi.mock('../db', () => ({ initDb: () => db }))

// agent-events imports `electron`, which the node test project has no window
// for. Mocking it also makes the announcement observable.
const emitAuditChanged = vi.fn()
vi.mock('./agent-events', () => ({ emitAuditChanged: (): void => emitAuditChanged() }))

const { listAuditEvents, recordAuditEvent } = await import('./audit-events')

const PERSONA_ID = 'persona-1'
const CONTACT_ID = 'contact-1'

beforeEach(() => {
  db = createTestDb()
  emitAuditChanged.mockClear()
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
  db.insert(contacts)
    .values({
      id: CONTACT_ID,
      personaTemplateId: PERSONA_ID,
      repoPath: '~/code/app',
      displayName: 'Code Reviewer · app',
      lastReadAt: new Date()
    })
    .run()
})

describe('recordAuditEvent', () => {
  it('defaults to a user actor and mints an id', () => {
    const event = recordAuditEvent({
      action: 'contact_renamed',
      repoPath: '~/code/app',
      contactId: CONTACT_ID,
      summary: 'Renamed to Reviewer'
    })

    expect(event.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(event.actorKind).toBe('user')
    expect(event.actorRoutineId).toBeUndefined()
    expect(emitAuditChanged).toHaveBeenCalledOnce()
  })

  it('stamps a routine actor with its routine id', () => {
    const event = recordAuditEvent({
      action: 'branch_merged',
      actor: { kind: 'routine', routineId: 'routine-1' },
      repoPath: '~/code/app',
      summary: 'Merged persona/reviewer-a1b2'
    })

    expect(event.actorKind).toBe('routine')
    expect(event.actorRoutineId).toBe('routine-1')
  })

  it('stamps a system actor', () => {
    const event = recordAuditEvent({
      action: 'worktree_reconciled',
      actor: { kind: 'system' },
      repoPath: '~/code/app',
      summary: 'Reconciled branch'
    })

    expect(event.actorKind).toBe('system')
  })

  it('carries metadata through', () => {
    const event = recordAuditEvent({
      action: 'contact_repo_trust_changed',
      repoPath: '~/code/app',
      contactId: CONTACT_ID,
      summary: 'Granted repo trust',
      metadata: {
        before: { instructions: false, skills: [] },
        after: { instructions: true, skills: [] }
      }
    })

    expect(event.metadata).toEqual({
      before: { instructions: false, skills: [] },
      after: { instructions: true, skills: [] }
    })
  })

  // The core survivability guarantee: an audit record that could be erased by
  // deleting the thing it describes is not an audit record. Same rule as
  // usage_events.contactId.
  it('survives the deletion of the contact it describes', () => {
    const event = recordAuditEvent({
      action: 'contact_deleted',
      repoPath: '~/code/app',
      contactId: CONTACT_ID,
      summary: 'Deleted Code Reviewer · app'
    })

    db.delete(contacts).where(eq(contacts.id, CONTACT_ID)).run()

    const [row] = listAuditEvents()
    expect(row.id).toBe(event.id)
    expect(row.contactId).toBeNull()
    expect(row.repoPath).toBe('~/code/app')
    expect(row.summary).toBe('Deleted Code Reviewer · app')
  })
})

describe('listAuditEvents', () => {
  it('orders newest first', () => {
    // Two calls in the same test can land on the same millisecond, which
    // would make the ordering assertion depend on an unspecified SQLite tie
    // break — so the clock is advanced explicitly between them.
    vi.useFakeTimers()
    try {
      vi.setSystemTime(1_000)
      recordAuditEvent({ action: 'repo_cloned', repoPath: '~/code/first', summary: 'Cloned first' })
      vi.setSystemTime(2_000)
      recordAuditEvent({
        action: 'repo_cloned',
        repoPath: '~/code/second',
        summary: 'Cloned second'
      })
    } finally {
      vi.useRealTimers()
    }

    const events = listAuditEvents()
    expect(events.map((e) => e.repoPath)).toEqual(['~/code/second', '~/code/first'])
  })
})
