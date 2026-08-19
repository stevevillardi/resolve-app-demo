import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestDb } from '../db/test-db'
import { contacts, groups } from '../db/schema'
import type { AppDatabase } from '../db/create'
import type { PersonaTemplateDraft } from '../../shared/domain'

/**
 * The delete rule is the reason this file exists: a persona with bound
 * contacts must not be deletable, and the refusal has to name them. SQLite's
 * ON DELETE RESTRICT is the real guarantee (which only holds because
 * createDb turns foreign keys on), while the service check is what makes the
 * failure legible.
 */

let db: AppDatabase

vi.mock('../db', () => ({ initDb: () => db }))

const {
  createPersonaTemplate,
  deletePersonaTemplate,
  getPersonaTemplate,
  listPersonaTemplates,
  updatePersonaTemplate
} = await import('./persona-templates')
const { acquire, resetRunLocks } = await import('./run-lock')

const DRAFT: PersonaTemplateDraft = {
  name: 'Code Reviewer',
  avatarColor: '#2a78d6',
  backend: 'claude',
  model: null,
  systemPrompt: 'Review carefully.',
  skillIds: ['skill-a'],
  mcpServerIds: [],
  sandbox: 'read_only',
  githubScope: 'read_only'
}

function bindContact(personaId: string, displayName: string): void {
  db.insert(groups)
    .values({ id: `g-${displayName}`, repoPath: `~/code/${displayName}` })
    .run()
  db.insert(contacts)
    .values({
      id: `c-${displayName}`,
      personaTemplateId: personaId,
      repoPath: `~/code/${displayName}`,
      displayName,
      backendSessionId: null
    })
    .run()
}

beforeEach(() => {
  db = createTestDb()
  resetRunLocks()
})

describe('create and read', () => {
  it('mints an id and round-trips every field', () => {
    const persona = createPersonaTemplate(DRAFT)
    expect(persona.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(getPersonaTemplate(persona.id)).toEqual(persona)
  })

  it('stores skillIds as a retrievable array', () => {
    const persona = createPersonaTemplate({ ...DRAFT, skillIds: ['a', 'b', 'c'] })
    expect(getPersonaTemplate(persona.id)?.skillIds).toEqual(['a', 'b', 'c'])
  })

  it('returns null for an unknown id', () => {
    expect(getPersonaTemplate('nope')).toBeNull()
  })

  it('lists alphabetically', () => {
    createPersonaTemplate({ ...DRAFT, name: 'Zebra' })
    createPersonaTemplate({ ...DRAFT, name: 'Alpha' })
    expect(listPersonaTemplates().map((p) => p.name)).toEqual(['Alpha', 'Zebra'])
  })
})

describe('update', () => {
  it('persists a change on both permission axes independently', () => {
    // Blueprint §4 is explicit that sandbox and githubScope are independent —
    // changing one must not drag the other along.
    const persona = createPersonaTemplate(DRAFT)
    updatePersonaTemplate({ ...persona, sandbox: 'workspace_write' })

    const saved = getPersonaTemplate(persona.id)
    expect(saved?.sandbox).toBe('workspace_write')
    expect(saved?.githubScope).toBe('read_only')
  })

  it('persists a replaced skill list', () => {
    const persona = createPersonaTemplate(DRAFT)
    updatePersonaTemplate({ ...persona, skillIds: [] })
    expect(getPersonaTemplate(persona.id)?.skillIds).toEqual([])
  })

  // Regression: `model` was added to the schema and the domain but not to this
  // service's `.set()`, so choosing one saved silently and reloaded as null.
  // An omitted column here is a no-op, not a type error — every column added
  // from now on needs a test that reads it back.
  it('persists a model choice, and clearing it back to the default', () => {
    const persona = createPersonaTemplate(DRAFT)

    updatePersonaTemplate({ ...persona, model: 'claude-opus-5' })
    expect(getPersonaTemplate(persona.id)?.model).toBe('claude-opus-5')

    updatePersonaTemplate({ ...persona, model: null })
    expect(getPersonaTemplate(persona.id)?.model).toBeNull()
  })

  // The debt the comment above asks for, paid on the way in rather than after
  // somebody notices their server selection does not stick.
  it('persists an MCP server allowlist, and emptying it again', () => {
    const persona = createPersonaTemplate(DRAFT)

    updatePersonaTemplate({ ...persona, mcpServerIds: ['github'] })
    expect(getPersonaTemplate(persona.id)?.mcpServerIds).toEqual(['github'])

    // Emptying has to survive the round trip too: the column is nullable and
    // toPersonaTemplate() coalesces null to [], so a revocation that wrote
    // nothing would read back as though it had worked.
    updatePersonaTemplate({ ...persona, mcpServerIds: [] })
    expect(getPersonaTemplate(persona.id)?.mcpServerIds).toEqual([])
  })

  it('starts a persona with no servers at all', () => {
    // A capability has to be granted, never inherited from a default.
    expect(createPersonaTemplate(DRAFT).mcpServerIds).toEqual([])
  })

  it('clears bound contacts resume keys when the backend changes', () => {
    // A backendSessionId is an index into one SDK's session storage. Leaving
    // it in place across a backend switch hands Codex a Claude UUID (or the
    // reverse) on the next turn, which surfaces as a raw vendor resume error.
    const persona = createPersonaTemplate(DRAFT)
    bindContact(persona.id, 'alpha')
    db.update(contacts).set({ backendSessionId: 'claude-session-1' }).run()

    updatePersonaTemplate({ ...persona, backend: 'codex', model: null })

    const contact = db.select().from(contacts).all()[0]
    expect(contact.backendSessionId).toBeNull()
  })

  it('keeps resume keys across a model-only change', () => {
    // Both SDKs accept a model override on resume, so a model edit must not
    // cost the contact its session — that would throw away vendor-side context
    // for a change the backend handles in place.
    const persona = createPersonaTemplate(DRAFT)
    bindContact(persona.id, 'alpha')
    db.update(contacts).set({ backendSessionId: 'claude-session-1' }).run()

    updatePersonaTemplate({ ...persona, model: 'claude-opus-5' })

    const contact = db.select().from(contacts).all()[0]
    expect(contact.backendSessionId).toBe('claude-session-1')
  })

  it('leaves contacts bound to other personas alone on a backend change', () => {
    const moving = createPersonaTemplate(DRAFT)
    const staying = createPersonaTemplate({ ...DRAFT, name: 'Docs Writer' })
    bindContact(moving.id, 'alpha')
    bindContact(staying.id, 'beta')
    db.update(contacts).set({ backendSessionId: 'session-x' }).run()

    updatePersonaTemplate({ ...moving, backend: 'codex', model: null })

    const rows = db.select().from(contacts).all()
    expect(rows.find((row) => row.id === 'c-alpha')?.backendSessionId).toBeNull()
    expect(rows.find((row) => row.id === 'c-beta')?.backendSessionId).toBe('session-x')
  })

  it('throws for a persona that no longer exists', () => {
    expect(() => updatePersonaTemplate({ id: 'missing', ...DRAFT })).toThrow(/No such persona/)
  })

  // The clear above and a finishing turn's own setBackendSessionId write the
  // same column, and the turn writes last — so without this the switch is
  // silently undone and the contact keeps a key for an SDK that has never
  // heard of it. The exact stranding the clear exists to prevent.
  it('refuses a backend change while a bound contact is mid-turn', () => {
    const persona = createPersonaTemplate(DRAFT)
    bindContact(persona.id, 'alpha')
    db.update(contacts).set({ backendSessionId: 'claude-session-1' }).run()
    const release = acquire({
      runId: 'run-1',
      contactId: 'c-alpha',
      contactName: 'alpha',
      workingPath: '~/code/alpha',
      mode: 'exclusive',
      startedAt: 0,
      origin: { kind: 'message' }
    })

    expect(() => updatePersonaTemplate({ ...persona, backend: 'codex', model: null })).toThrow(
      /alpha is working right now/
    )
    // Nothing written: not the persona, and not the resume key.
    expect(getPersonaTemplate(persona.id)?.backend).toBe('claude')
    expect(db.select().from(contacts).all()[0].backendSessionId).toBe('claude-session-1')

    release?.()
    updatePersonaTemplate({ ...persona, backend: 'codex', model: null })
    expect(getPersonaTemplate(persona.id)?.backend).toBe('codex')
  })

  // Narrow on purpose. Everything but the backend is read when a turn starts,
  // so editing it under a running turn simply applies from the next one —
  // freezing the whole editor whenever anything is working would be a worse
  // trade than the race it prevents.
  it('allows every other edit while a bound contact is mid-turn', () => {
    const persona = createPersonaTemplate(DRAFT)
    bindContact(persona.id, 'alpha')
    acquire({
      runId: 'run-2',
      contactId: 'c-alpha',
      contactName: 'alpha',
      workingPath: '~/code/alpha',
      mode: 'exclusive',
      startedAt: 0,
      origin: { kind: 'message' }
    })

    updatePersonaTemplate({ ...persona, name: 'Renamed', sandbox: 'workspace_write' })
    expect(getPersonaTemplate(persona.id)?.name).toBe('Renamed')
  })
})

describe('delete', () => {
  it('removes an unbound persona', () => {
    const persona = createPersonaTemplate(DRAFT)
    deletePersonaTemplate(persona.id)
    expect(getPersonaTemplate(persona.id)).toBeNull()
  })

  it('refuses while a contact is bound, and names it', () => {
    const persona = createPersonaTemplate(DRAFT)
    bindContact(persona.id, 'app')

    expect(() => deletePersonaTemplate(persona.id)).toThrow(/app/)
    expect(getPersonaTemplate(persona.id)).not.toBeNull()
  })

  it('names every bound contact, not just the first', () => {
    const persona = createPersonaTemplate(DRAFT)
    bindContact(persona.id, 'app')
    bindContact(persona.id, 'site')

    expect(() => deletePersonaTemplate(persona.id)).toThrow(/app.*site|site.*app/)
  })

  it('pluralises the refusal correctly for a single contact', () => {
    const persona = createPersonaTemplate(DRAFT)
    bindContact(persona.id, 'app')
    expect(() => deletePersonaTemplate(persona.id)).toThrow(/1 contact still bound/)
  })

  it('succeeds once the contacts are gone', () => {
    const persona = createPersonaTemplate(DRAFT)
    bindContact(persona.id, 'app')
    db.delete(contacts).run()

    expect(() => deletePersonaTemplate(persona.id)).not.toThrow()
    expect(getPersonaTemplate(persona.id)).toBeNull()
  })

  it('leaves a different persona bound to its own contact alone', () => {
    const kept = createPersonaTemplate({ ...DRAFT, name: 'Kept' })
    const removed = createPersonaTemplate({ ...DRAFT, name: 'Removed' })
    bindContact(kept.id, 'app')

    deletePersonaTemplate(removed.id)

    expect(getPersonaTemplate(kept.id)).not.toBeNull()
    expect(getPersonaTemplate(removed.id)).toBeNull()
  })
})

describe('the foreign key behind the check', () => {
  it('blocks the delete even when the service check is bypassed', () => {
    // Proves ON DELETE RESTRICT is genuinely enforced — i.e. that
    // `PRAGMA foreign_keys = ON` really is set. Without it this raw delete
    // would succeed and leave a contact pointing at nothing.
    const persona = createPersonaTemplate(DRAFT)
    bindContact(persona.id, 'app')

    let thrown: unknown
    try {
      db.run(`delete from persona_templates where id = '${persona.id}'`)
    } catch (error) {
      thrown = error
    }

    // Drizzle wraps the driver error, so the SQLite text is on the cause.
    expect(thrown).toBeInstanceOf(Error)
    expect(String((thrown as Error).cause)).toMatch(/FOREIGN KEY/i)
    expect(getPersonaTemplate(persona.id)).not.toBeNull()
  })
})

describe('the full_access scope rule', () => {
  it('refuses to create full sandbox with a narrower GitHub scope', () => {
    expect(() =>
      createPersonaTemplate({ ...DRAFT, sandbox: 'full_access', githubScope: 'read_only' })
    ).toThrow(/full sandbox access/i)
    expect(() =>
      createPersonaTemplate({ ...DRAFT, sandbox: 'full_access', githubScope: 'open_pr' })
    ).toThrow(/full sandbox access/i)
  })

  it('accepts the paired combination, and narrower scopes below full sandbox', () => {
    expect(
      createPersonaTemplate({ ...DRAFT, sandbox: 'full_access', githubScope: 'full_access' })
        .sandbox
    ).toBe('full_access')
    expect(
      createPersonaTemplate({ ...DRAFT, sandbox: 'workspace_write', githubScope: 'read_only' })
        .githubScope
    ).toBe('read_only')
  })

  it('refuses the combination on update too', () => {
    const persona = createPersonaTemplate(DRAFT)
    expect(() =>
      updatePersonaTemplate({ ...persona, sandbox: 'full_access', githubScope: 'read_only' })
    ).toThrow(/full sandbox access/i)
    // The refusal happened before any write.
    expect(getPersonaTemplate(persona.id)?.sandbox).toBe('read_only')
  })
})
