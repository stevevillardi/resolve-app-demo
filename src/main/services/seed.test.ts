import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestDb } from '../db/test-db'
import { SEED_PERSONA_TEMPLATES, SEED_SKILLS } from '../db/seed-data'
import type { AppDatabase } from '../db/create'

/**
 * The behaviour worth protecting is that seeding happens exactly once, ever.
 * The tempting implementation — "seed if the tables are empty" — quietly
 * resurrects content the user deliberately deleted, so the marker check is
 * the actual contract here, not an implementation detail.
 */

let db: AppDatabase

vi.mock('../db', () => ({ initDb: () => db }))

const { seedIfNeeded } = await import('./seed')
const { getAppState } = await import('./app-state')
const { deleteSkill, listSkills } = await import('./skills')
const { listPersonaTemplates } = await import('./persona-templates')

beforeEach(() => {
  db = createTestDb()
})

describe('first run', () => {
  it('inserts every default skill and persona', () => {
    seedIfNeeded()
    expect(listSkills()).toHaveLength(SEED_SKILLS.length)
    expect(listPersonaTemplates()).toHaveLength(SEED_PERSONA_TEMPLATES.length)
  })

  it('records that seeding happened', () => {
    expect(getAppState('seed_version')).toBeNull()
    seedIfNeeded()
    expect(getAppState('seed_version')).toBe('1')
  })

  it('seeds no contacts or groups', () => {
    // Those bind to a real local repo path, which nothing can know yet.
    seedIfNeeded()
    expect(db.all(`select count(*) as n from contacts`)).toEqual([{ n: 0 }])
    expect(db.all(`select count(*) as n from groups`)).toEqual([{ n: 0 }])
  })

  it('preserves each persona’s skill attachments', () => {
    seedIfNeeded()
    const reviewer = listPersonaTemplates().find((p) => p.name === 'Code Reviewer')
    expect(reviewer?.skillIds).toEqual(['skill-typescript-style', 'skill-security-checklist'])
  })

  it('attaches only skills that were themselves seeded', () => {
    // A persona pointing at a skill id that does not exist would render an
    // attachment the editor can't show or unattach.
    seedIfNeeded()
    const skillIds = new Set(listSkills().map((s) => s.id))
    for (const persona of listPersonaTemplates()) {
      for (const id of persona.skillIds) expect(skillIds).toContain(id)
    }
  })
})

describe('subsequent runs', () => {
  it('is a no-op when called again', () => {
    seedIfNeeded()
    seedIfNeeded()
    expect(listSkills()).toHaveLength(SEED_SKILLS.length)
  })

  it('does not resurrect a skill the user deleted', () => {
    // The whole reason the guard is a marker rather than an emptiness check.
    seedIfNeeded()
    deleteSkill('skill-api-design')
    seedIfNeeded()

    expect(listSkills().map((s) => s.id)).not.toContain('skill-api-design')
    expect(listSkills()).toHaveLength(SEED_SKILLS.length - 1)
  })

  it('does not re-seed after the user has emptied the library entirely', () => {
    seedIfNeeded()
    for (const skill of listSkills()) deleteSkill(skill.id)
    seedIfNeeded()
    expect(listSkills()).toEqual([])
  })
})

describe('colliding with rows that already exist', () => {
  it('leaves the existing row alone and still completes', () => {
    // A hand-restored or partially migrated profile can already hold a row at
    // a stable seed id. onConflictDoNothing makes that survivable: the user's
    // row wins and the rest of the seed still lands, rather than one
    // collision aborting the whole transaction.
    const last = SEED_PERSONA_TEMPLATES[SEED_PERSONA_TEMPLATES.length - 1]
    db.run(
      `insert into persona_templates (id, name, avatar_color, backend, system_prompt, skill_ids, sandbox, github_scope)
       values ('${last.id}', 'Existing', '#000', 'claude', '', '[]', 'read_only', 'read_only')`
    )
    expect(() => seedIfNeeded()).not.toThrow()
    expect(listPersonaTemplates().find((p) => p.id === last.id)?.name).toBe('Existing')
    expect(listSkills()).toHaveLength(SEED_SKILLS.length)
    expect(getAppState('seed_version')).toBe('1')
  })
})
