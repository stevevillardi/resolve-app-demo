import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestDb } from '../db/test-db'
import { personaTemplates } from '../db/schema'
import type { AppDatabase } from '../db/create'

/**
 * Runs against a real migrated in-memory database. The interesting behaviour
 * here is the delete: it detaches the skill from every persona that referenced
 * it, and `skill_ids` is a JSON array with no foreign key to enforce that —
 * only this code keeps the two consistent.
 */

let db: AppDatabase

vi.mock('../db', () => ({ initDb: () => db }))

const { createSkill, deleteSkill, getSkill, listSkills, personasUsingSkill, updateSkill } =
  await import('./skills')

function insertPersona(id: string, name: string, skillIds: string[]): void {
  db.insert(personaTemplates)
    .values({
      id,
      name,
      avatarColor: '#2a78d6',
      backend: 'claude',
      systemPrompt: '',
      skillIds,
      sandbox: 'read_only',
      githubScope: 'read_only'
    })
    .run()
}

beforeEach(() => {
  db = createTestDb()
})

describe('create and read', () => {
  it('mints an id rather than taking one from the caller', () => {
    const skill = createSkill({ name: 'Style', description: 'How', content: '# Style' })
    expect(skill.id).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('round-trips through the database', () => {
    const created = createSkill({ name: 'Style', description: 'How', content: '# Style' })
    expect(getSkill(created.id)).toEqual(created)
  })

  it('returns null for an id that does not exist', () => {
    expect(getSkill('nope')).toBeNull()
  })

  it('gives two skills distinct ids', () => {
    const a = createSkill({ name: 'A', description: '', content: '' })
    const b = createSkill({ name: 'B', description: '', content: '' })
    expect(a.id).not.toBe(b.id)
  })

  it('lists alphabetically, not in insertion order', () => {
    createSkill({ name: 'Zebra', description: '', content: '' })
    createSkill({ name: 'Alpha', description: '', content: '' })
    expect(listSkills().map((s) => s.name)).toEqual(['Alpha', 'Zebra'])
  })

  it('starts empty', () => {
    expect(listSkills()).toEqual([])
  })
})

describe('update', () => {
  it('persists every editable field', () => {
    const skill = createSkill({ name: 'Old', description: 'Old', content: 'Old' })
    updateSkill({ ...skill, name: 'New', description: 'Newer', content: 'Newest' })
    expect(getSkill(skill.id)).toEqual({
      id: skill.id,
      name: 'New',
      description: 'Newer',
      content: 'Newest'
    })
  })

  it('throws rather than silently doing nothing when the skill is gone', () => {
    // A no-op update would leave the editor showing saved changes that were
    // never written.
    expect(() => updateSkill({ id: 'missing', name: 'x', description: '', content: '' })).toThrow(
      /no longer exists/
    )
  })
})

describe('delete', () => {
  it('removes the skill', () => {
    const skill = createSkill({ name: 'Style', description: '', content: '' })
    deleteSkill(skill.id)
    expect(getSkill(skill.id)).toBeNull()
  })

  it('strips the id from every persona that referenced it', () => {
    const skill = createSkill({ name: 'Style', description: '', content: '' })
    insertPersona('p1', 'One', [skill.id, 'other'])
    insertPersona('p2', 'Two', ['other', skill.id])

    deleteSkill(skill.id)

    const remaining = db.select().from(personaTemplates).all()
    expect(remaining.map((p) => p.skillIds)).toEqual([['other'], ['other']])
  })

  it('leaves personas that never referenced it untouched', () => {
    const skill = createSkill({ name: 'Style', description: '', content: '' })
    insertPersona('p1', 'One', ['unrelated-a', 'unrelated-b'])

    deleteSkill(skill.id)

    expect(db.select().from(personaTemplates).all()[0].skillIds).toEqual([
      'unrelated-a',
      'unrelated-b'
    ])
  })

  it('empties the array when the deleted skill was the only one attached', () => {
    const skill = createSkill({ name: 'Style', description: '', content: '' })
    insertPersona('p1', 'One', [skill.id])
    deleteSkill(skill.id)
    expect(db.select().from(personaTemplates).all()[0].skillIds).toEqual([])
  })

  it('is a no-op for an id that does not exist', () => {
    insertPersona('p1', 'One', ['a'])
    expect(() => deleteSkill('missing')).not.toThrow()
    expect(db.select().from(personaTemplates).all()[0].skillIds).toEqual(['a'])
  })
})

describe('personasUsingSkill', () => {
  it('names the personas that attach it', () => {
    const skill = createSkill({ name: 'Style', description: '', content: '' })
    insertPersona('p1', 'Code Reviewer', [skill.id])
    insertPersona('p2', 'Docs Writer', [])
    insertPersona('p3', 'Refactor Buddy', ['other', skill.id])

    expect(personasUsingSkill(skill.id).sort()).toEqual(['Code Reviewer', 'Refactor Buddy'])
  })

  it('returns nothing for an unattached skill', () => {
    const skill = createSkill({ name: 'Style', description: '', content: '' })
    insertPersona('p1', 'One', [])
    expect(personasUsingSkill(skill.id)).toEqual([])
  })
})
