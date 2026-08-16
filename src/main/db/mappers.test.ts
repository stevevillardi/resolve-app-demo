import { beforeEach, describe, expect, it } from 'vitest'
import { createTestDb } from './test-db'
import {
  toContact,
  toGroupMessage,
  toMessage,
  toPersonaTemplate,
  toRoutine,
  toSkill,
  toUsageEvent
} from './mappers'
import {
  contacts,
  groupMessages,
  groups,
  messages,
  personaTemplates,
  routines,
  skills,
  usageEvents
} from './schema'
import type { AppDatabase } from './create'

/**
 * Round-trips through a real migrated database rather than hand-built row
 * objects. The three conversions that matter — Date to epoch ms, integer to
 * boolean, TEXT to a parsed JSON array — are all things Drizzle does on the
 * way out, so constructing fake rows in TypeScript would test the mapper
 * against a shape SQLite never actually produces.
 */

let db: AppDatabase

const TIMESTAMP = Date.parse('2026-08-16T09:30:00Z')

beforeEach(() => {
  db = createTestDb()
})

/** Minimal fixture chain — most tables need a contact, which needs a persona. */
function seedContact(): void {
  db.insert(personaTemplates)
    .values({
      id: 'p1',
      name: 'Code Reviewer',
      avatarColor: '#2a78d6',
      backend: 'claude',
      systemPrompt: 'Review carefully.',
      skillIds: ['s1', 's2'],
      sandbox: 'read_only',
      githubScope: 'read_only'
    })
    .run()
  db.insert(groups).values({ id: 'g1', repoPath: '~/code/app' }).run()
  db.insert(contacts)
    .values({
      id: 'c1',
      personaTemplateId: 'p1',
      repoPath: '~/code/app',
      displayName: 'Code Reviewer · app',
      backendSessionId: null
    })
    .run()
}

describe('toSkill', () => {
  it('round-trips every field', () => {
    db.insert(skills)
      .values({ id: 's1', name: 'Style', description: 'How', content: '# Style' })
      .run()
    const row = db.select().from(skills).all()[0]
    expect(toSkill(row)).toEqual({
      id: 's1',
      name: 'Style',
      description: 'How',
      content: '# Style'
    })
  })
})

describe('toPersonaTemplate', () => {
  it('returns skillIds as a real array, not the stored JSON string', () => {
    seedContact()
    const persona = toPersonaTemplate(db.select().from(personaTemplates).all()[0])
    expect(Array.isArray(persona.skillIds)).toBe(true)
    expect(persona.skillIds).toEqual(['s1', 's2'])
  })

  it('preserves an empty skill list rather than collapsing it to undefined', () => {
    db.insert(personaTemplates)
      .values({
        id: 'p2',
        name: 'Blank',
        avatarColor: '#000000',
        backend: 'codex',
        systemPrompt: '',
        skillIds: [],
        sandbox: 'full_access',
        githubScope: 'open_pr'
      })
      .run()
    const persona = toPersonaTemplate(db.select().from(personaTemplates).all()[0])
    expect(persona.skillIds).toEqual([])
  })
})

describe('toContact', () => {
  it('keeps a null backendSessionId null rather than dropping the key', () => {
    // "No session yet" is meaningful state (§4) — an absent key would read as
    // unknown, and the persona editor prints one differently from the other.
    seedContact()
    const contact = toContact(db.select().from(contacts).all()[0])
    expect(contact.backendSessionId).toBeNull()
    expect('backendSessionId' in contact).toBe(true)
  })
})

describe('toMessage', () => {
  it('converts the stored Date back to epoch milliseconds', () => {
    seedContact()
    db.insert(messages)
      .values({
        id: 'm1',
        contactId: 'c1',
        role: 'user',
        content: 'Review auth.ts',
        timestamp: new Date(TIMESTAMP)
      })
      .run()
    const message = toMessage(db.select().from(messages).all()[0])
    expect(message.timestamp).toBe(TIMESTAMP)
    expect(typeof message.timestamp).toBe('number')
  })
})

describe('toGroupMessage', () => {
  it('omits optional fields that are null in the row', () => {
    // A user_mention has no contact, category, or durable flag.
    seedContact()
    db.insert(groupMessages)
      .values({
        id: 'gm1',
        groupId: 'g1',
        timestamp: new Date(TIMESTAMP),
        type: 'user_mention',
        content: '@Code Reviewer look at this'
      })
      .run()
    const message = toGroupMessage(db.select().from(groupMessages).all()[0])
    expect(message).toEqual({
      id: 'gm1',
      groupId: 'g1',
      timestamp: TIMESTAMP,
      type: 'user_mention',
      content: '@Code Reviewer look at this'
    })
    expect('contactId' in message).toBe(false)
    expect('durable' in message).toBe(false)
  })

  it('carries a durable system_summary through with its category', () => {
    seedContact()
    db.insert(groupMessages)
      .values({
        id: 'gm2',
        groupId: 'g1',
        timestamp: new Date(TIMESTAMP),
        type: 'system_summary',
        contactId: 'c1',
        content: 'Renamed fetchStuff.',
        category: 'decision',
        durable: true
      })
      .run()
    const message = toGroupMessage(db.select().from(groupMessages).all()[0])
    expect(message.category).toBe('decision')
    expect(message.durable).toBe(true)
    expect(message.contactId).toBe('c1')
  })

  it('keeps durable:false rather than treating it as absent', () => {
    // Stored as integer 0 — the falsy-vs-null distinction is exactly what the
    // mapper's null check exists to preserve.
    seedContact()
    db.insert(groupMessages)
      .values({
        id: 'gm3',
        groupId: 'g1',
        timestamp: new Date(TIMESTAMP),
        type: 'system_summary',
        contactId: 'c1',
        content: 'Routine run, nothing to do.',
        category: 'routine',
        durable: false
      })
      .run()
    const message = toGroupMessage(db.select().from(groupMessages).all()[0])
    expect(message.durable).toBe(false)
    expect('durable' in message).toBe(true)
  })
})

describe('toRoutine', () => {
  it('maps enabled to a boolean and a null lastRunAt to null', () => {
    seedContact()
    db.insert(routines)
      .values({
        id: 'r1',
        contactId: 'c1',
        schedule: '0 9 * * *',
        prompt: 'Sweep for issues.',
        enabled: true,
        lastRunAt: null,
        lastRunSummary: null
      })
      .run()
    const routine = toRoutine(db.select().from(routines).all()[0])
    expect(routine.enabled).toBe(true)
    expect(routine.lastRunAt).toBeNull()
    expect(routine.lastRunSummary).toBeNull()
  })

  it('converts a set lastRunAt to epoch milliseconds', () => {
    seedContact()
    db.insert(routines)
      .values({
        id: 'r2',
        contactId: 'c1',
        schedule: '0 9 * * *',
        prompt: 'Sweep.',
        enabled: false,
        lastRunAt: new Date(TIMESTAMP),
        lastRunSummary: 'Fixed 2 lint issues.'
      })
      .run()
    const routine = toRoutine(db.select().from(routines).all()[0])
    expect(routine.enabled).toBe(false)
    expect(routine.lastRunAt).toBe(TIMESTAMP)
  })
})

describe('toUsageEvent', () => {
  it('preserves a fractional cost through the REAL column', () => {
    // An INTEGER column would round this to 0 — the reason cost_usd is REAL.
    seedContact()
    db.insert(usageEvents)
      .values({
        id: 'u1',
        contactId: 'c1',
        timestamp: new Date(TIMESTAMP),
        source: 'message',
        inputTokens: 3200,
        outputTokens: 540,
        cachedInputTokens: 2100,
        costUsd: 0.041
      })
      .run()
    const event = toUsageEvent(db.select().from(usageEvents).all()[0])
    expect(event.costUsd).toBeCloseTo(0.041, 6)
    expect(event.cachedInputTokens).toBe(2100)
  })

  it('keeps a null cost null and omits absent cached tokens', () => {
    // Codex reports tokens but no dollar figure (§3).
    seedContact()
    db.insert(usageEvents)
      .values({
        id: 'u2',
        contactId: 'c1',
        timestamp: new Date(TIMESTAMP),
        source: 'routine',
        inputTokens: 8600,
        outputTokens: 940,
        costUsd: null
      })
      .run()
    const event = toUsageEvent(db.select().from(usageEvents).all()[0])
    expect(event.costUsd).toBeNull()
    expect('cachedInputTokens' in event).toBe(false)
  })

  it('carries every field an adapter reports, so none is dropped on the way in', () => {
    // The table used to keep tokens and cost only, which meant AgentUsage
    // (src/shared/agent.ts) could not be persisted as produced — the model
    // that served the turn went unrecorded, leaving its spend unattributable.
    seedContact()
    db.insert(usageEvents)
      .values({
        id: 'u3',
        contactId: 'c1',
        timestamp: new Date(TIMESTAMP),
        source: 'message',
        inputTokens: 12231,
        outputTokens: 58,
        cachedInputTokens: 4480,
        cacheWriteInputTokens: 1845,
        reasoningOutputTokens: 32,
        costUsd: 0.0402,
        model: 'gpt-5.5',
        costSource: 'computed'
      })
      .run()
    const event = toUsageEvent(db.select().from(usageEvents).all()[0])
    expect(event.model).toBe('gpt-5.5')
    expect(event.costSource).toBe('computed')
    expect(event.cacheWriteInputTokens).toBe(1845)
    expect(event.reasoningOutputTokens).toBe(32)
  })

  it('omits the attribution fields on rows written before they existed', () => {
    // Migration 0004 is additive with no backfill, so every pre-existing row
    // reads back as "we don't know which model this was" rather than guessing.
    seedContact()
    db.insert(usageEvents)
      .values({
        id: 'u4',
        contactId: 'c1',
        timestamp: new Date(TIMESTAMP),
        source: 'message',
        inputTokens: 10,
        outputTokens: 2,
        costUsd: null
      })
      .run()
    const event = toUsageEvent(db.select().from(usageEvents).all()[0])
    expect('model' in event).toBe(false)
    expect('costSource' in event).toBe(false)
  })
})
