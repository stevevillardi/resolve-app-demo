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

const DRAFT: PersonaTemplateDraft = {
  name: 'Code Reviewer',
  avatarColor: '#2a78d6',
  backend: 'claude',
  model: null,
  systemPrompt: 'Review carefully.',
  skillIds: ['skill-a'],
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

  it('throws for a persona that no longer exists', () => {
    expect(() => updatePersonaTemplate({ id: 'missing', ...DRAFT })).toThrow(/No such persona/)
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
