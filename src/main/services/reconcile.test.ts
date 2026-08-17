import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestDb } from '../db/test-db'
import { contacts, personaTemplates, toolCalls } from '../db/schema'
import type { AppDatabase } from '../db/create'

let db: AppDatabase
vi.mock('../db', () => ({ initDb: () => db }))

const { sweepInterruptedToolCalls } = await import('./reconcile')

function seedCall(id: string, status: 'running' | 'completed' | 'failed'): void {
  db.insert(toolCalls)
    .values({
      id,
      contactId: 'contact-a',
      messageId: null,
      toolCallId: `backend-${id}`,
      name: 'Bash',
      status,
      createdAt: new Date(),
      detail: 'npm test'
    })
    .run()
}

beforeEach(() => {
  db = createTestDb()
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
})

describe('sweepInterruptedToolCalls', () => {
  it('marks every running row failed, keeping its detail and (lack of) message', () => {
    seedCall('orphan', 'running')

    const changed = sweepInterruptedToolCalls()

    const [row] = db.select().from(toolCalls).all()
    expect(changed).toBe(1)
    expect(row.status).toBe('failed')
    // The record of what the call was doing survives the sweep — only the
    // claim that it is still doing it goes.
    expect(row.detail).toBe('npm test')
    expect(row.messageId).toBeNull()
  })

  it('leaves finished rows alone', () => {
    seedCall('done', 'completed')
    seedCall('broke', 'failed')

    expect(sweepInterruptedToolCalls()).toBe(0)

    const statuses = db
      .select()
      .from(toolCalls)
      .all()
      .map((row) => row.status)
      .sort()
    expect(statuses).toEqual(['completed', 'failed'])
  })

  it('reports zero on an empty table', () => {
    expect(sweepInterruptedToolCalls()).toBe(0)
  })
})
