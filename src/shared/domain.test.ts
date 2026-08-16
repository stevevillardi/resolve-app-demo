import { describe, expect, it } from 'vitest'
import {
  contactSchema,
  groupMessageSchema,
  personaTemplateDraftSchema,
  personaTemplateSchema,
  routineSchema,
  skillDraftSchema,
  usageEventSchema
} from './domain'

/**
 * These schemas are the only thing standing between a malformed renderer
 * payload and a SQLite write — registerProcedure parses against them at the
 * boundary. SQLite has no enum type and will happily store 'telepathy' in the
 * `backend` column, so the union checks below are the real enforcement.
 */

const PERSONA = {
  id: 'p1',
  name: 'Code Reviewer',
  avatarColor: '#2a78d6',
  backend: 'claude',
  model: null,
  systemPrompt: 'Review carefully.',
  skillIds: ['s1'],
  sandbox: 'read_only',
  githubScope: 'read_only'
}

describe('personaTemplate', () => {
  it('accepts a well-formed persona', () => {
    expect(() => personaTemplateSchema.parse(PERSONA)).not.toThrow()
  })

  it('rejects an unknown backend', () => {
    expect(() => personaTemplateSchema.parse({ ...PERSONA, backend: 'cursor' })).toThrow()
  })

  it('rejects an unknown sandbox level', () => {
    expect(() => personaTemplateSchema.parse({ ...PERSONA, sandbox: 'yolo' })).toThrow()
  })

  it('rejects an unknown github scope', () => {
    expect(() => personaTemplateSchema.parse({ ...PERSONA, githubScope: 'admin' })).toThrow()
  })

  it('keeps the two permission axes independent', () => {
    // Blueprint §4 is explicit that these don't have to agree, so no
    // cross-field rule should reject a read-only sandbox that can open PRs.
    expect(() =>
      personaTemplateSchema.parse({
        ...PERSONA,
        sandbox: 'read_only',
        githubScope: 'full_access'
      })
    ).not.toThrow()
  })

  it('takes a model name or an explicit null, but not an absent one', () => {
    // Null is a choice — "use whatever this backend defaults to" — so it has
    // to be stated rather than left off. Free text because which models an
    // account may use is decided by the vendor, not by this schema.
    expect(() => personaTemplateSchema.parse({ ...PERSONA, model: 'gpt-5.5' })).not.toThrow()
    expect(() => personaTemplateSchema.parse({ ...PERSONA, model: null })).not.toThrow()
    const withoutModel = { ...PERSONA }
    delete (withoutModel as { model?: unknown }).model
    expect(() => personaTemplateSchema.parse(withoutModel)).toThrow()
  })

  it('rejects skillIds that is not an array', () => {
    expect(() => personaTemplateSchema.parse({ ...PERSONA, skillIds: 's1' })).toThrow()
  })

  it('rejects an array of non-strings', () => {
    expect(() => personaTemplateSchema.parse({ ...PERSONA, skillIds: [1, 2] })).toThrow()
  })

  it('accepts an empty skill list', () => {
    expect(() => personaTemplateSchema.parse({ ...PERSONA, skillIds: [] })).not.toThrow()
  })
})

describe('drafts', () => {
  it('rejects a persona draft that smuggles in an id', () => {
    // Ids are minted in main. A supplied one would either be ignored — making
    // the caller's intent silently untrue — or let the renderer choose
    // primary keys.
    const result = personaTemplateDraftSchema.safeParse(PERSONA)
    expect(result.success && 'id' in result.data).toBe(false)
  })

  it('accepts a skill draft with no id', () => {
    expect(() =>
      skillDraftSchema.parse({ name: 'Style', description: '', content: '' })
    ).not.toThrow()
  })

  it('still requires the remaining fields', () => {
    expect(() => skillDraftSchema.parse({ name: 'Style' })).toThrow()
  })
})

describe('contact', () => {
  it('requires backendSessionId to be present, even as null', () => {
    // Null means "no session yet"; omitting it would mean "unknown", and the
    // persona editor renders those differently.
    expect(() =>
      contactSchema.parse({
        id: 'c1',
        personaTemplateId: 'p1',
        repoPath: '~/code/app',
        displayName: 'Code Reviewer · app'
      })
    ).toThrow()
  })

  it('accepts an explicit null session', () => {
    expect(() =>
      contactSchema.parse({
        id: 'c1',
        personaTemplateId: 'p1',
        repoPath: '~/code/app',
        displayName: 'Code Reviewer · app',
        backendSessionId: null
      })
    ).not.toThrow()
  })
})

describe('groupMessage', () => {
  const BASE = { id: 'gm1', groupId: 'g1', timestamp: 1_700_000_000_000, content: 'hi' }

  it('accepts a user_mention with no contact', () => {
    expect(() => groupMessageSchema.parse({ ...BASE, type: 'user_mention' })).not.toThrow()
  })

  it('accepts a durable system_summary with a category', () => {
    expect(() =>
      groupMessageSchema.parse({
        ...BASE,
        type: 'system_summary',
        contactId: 'c1',
        category: 'decision',
        durable: true
      })
    ).not.toThrow()
  })

  it('rejects an unknown message type', () => {
    expect(() => groupMessageSchema.parse({ ...BASE, type: 'shout' })).toThrow()
  })

  it('rejects an unknown summary category', () => {
    expect(() =>
      groupMessageSchema.parse({ ...BASE, type: 'system_summary', category: 'vibes' })
    ).toThrow()
  })

  it('covers every type the group thread can render', () => {
    for (const type of ['system_summary', 'user_mention', 'agent_reply', 'routine_run']) {
      expect(() => groupMessageSchema.parse({ ...BASE, type })).not.toThrow()
    }
  })
})

describe('routine', () => {
  it('requires lastRunAt and lastRunSummary to be present, even as null', () => {
    expect(() =>
      routineSchema.parse({
        id: 'r1',
        contactId: 'c1',
        schedule: '0 9 * * *',
        prompt: 'Sweep.',
        enabled: true
      })
    ).toThrow()
  })

  it('accepts a never-run routine', () => {
    expect(() =>
      routineSchema.parse({
        id: 'r1',
        contactId: 'c1',
        schedule: '0 9 * * *',
        prompt: 'Sweep.',
        enabled: true,
        lastRunAt: null,
        lastRunSummary: null
      })
    ).not.toThrow()
  })
})

describe('usageEvent', () => {
  const BASE = {
    id: 'u1',
    contactId: 'c1',
    timestamp: 1_700_000_000_000,
    source: 'message',
    inputTokens: 100,
    outputTokens: 20
  }

  it('accepts a null cost', () => {
    // Codex reports tokens but no dollar figure (§3).
    expect(() => usageEventSchema.parse({ ...BASE, costUsd: null })).not.toThrow()
  })

  it('accepts a fractional cost', () => {
    expect(() => usageEventSchema.parse({ ...BASE, costUsd: 0.0412 })).not.toThrow()
  })

  it('treats cachedInputTokens as optional', () => {
    expect(() => usageEventSchema.parse({ ...BASE, costUsd: null })).not.toThrow()
    expect(() =>
      usageEventSchema.parse({ ...BASE, costUsd: null, cachedInputTokens: 90 })
    ).not.toThrow()
  })

  it('rejects an unknown source', () => {
    expect(() => usageEventSchema.parse({ ...BASE, source: 'telepathy', costUsd: null })).toThrow()
  })

  it('records which model served the turn and where the cost came from', () => {
    // Both are optional because rows written before migration 0004 have
    // neither, and an absent model must not be mistaken for a known one.
    expect(() =>
      usageEventSchema.parse({
        ...BASE,
        costUsd: 0.04,
        model: 'gpt-5.5',
        costSource: 'computed',
        cacheWriteInputTokens: 1845,
        reasoningOutputTokens: 32
      })
    ).not.toThrow()
    expect(() => usageEventSchema.parse({ ...BASE, costUsd: null })).not.toThrow()
  })

  it('rejects a cost source that is neither the backend nor us', () => {
    expect(() =>
      usageEventSchema.parse({ ...BASE, costUsd: 0.04, costSource: 'guessed' })
    ).toThrow()
  })

  it('requires costUsd to be present, even as null', () => {
    expect(() => usageEventSchema.parse(BASE)).toThrow()
  })
})
