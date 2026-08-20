import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestDb } from '../db/test-db'
import {
  RECOMMENDED_PERSONA_IDS,
  RECOMMENDED_SKILL_IDS,
  SEED_PERSONA_TEMPLATES,
  SEED_SKILLS
} from '../db/seed-data'
import type { AppDatabase } from '../db/create'

/**
 * The behaviour worth protecting is that seeding happens exactly once, ever.
 * The tempting implementation — "seed if the tables are empty" — quietly
 * resurrects content the user deliberately deleted, so the marker check is
 * the actual contract here, not an implementation detail.
 */

let db: AppDatabase

vi.mock('../db', () => ({ initDb: () => db }))

const { applyStarterSelection, seedIfNeeded, starterCatalog } = await import('./seed')
const { getAppState } = await import('./app-state')
const { deleteSkill, listSkills } = await import('./skills')
const { listPersonaTemplates } = await import('./persona-templates')

beforeEach(() => {
  db = createTestDb()
})

describe('first run', () => {
  it('inserts the recommended tier and only the recommended tier', () => {
    // Startup seeding is the recommended tier and nothing else; the wider
    // catalog is opt-in through the picker, never installed uninvited.
    seedIfNeeded()
    expect(new Set(listSkills().map((s) => s.id))).toEqual(RECOMMENDED_SKILL_IDS)
    expect(new Set(listPersonaTemplates().map((p) => p.id))).toEqual(RECOMMENDED_PERSONA_IDS)
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
    expect(listSkills()).toHaveLength(RECOMMENDED_SKILL_IDS.size)
  })

  it('does not resurrect a skill the user deleted', () => {
    // The whole reason the guard is a marker rather than an emptiness check.
    seedIfNeeded()
    deleteSkill('skill-api-design')
    seedIfNeeded()

    expect(listSkills().map((s) => s.id)).not.toContain('skill-api-design')
    expect(listSkills()).toHaveLength(RECOMMENDED_SKILL_IDS.size - 1)
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
    // A *recommended* id, so the colliding insert genuinely happens.
    const last = SEED_PERSONA_TEMPLATES[0]
    db.run(
      `insert into persona_templates (id, name, avatar_color, backend, system_prompt, skill_ids, sandbox, github_scope)
       values ('${last.id}', 'Existing', '#000', 'claude', '', '[]', 'read_only', 'read_only')`
    )
    expect(() => seedIfNeeded()).not.toThrow()
    expect(listPersonaTemplates().find((p) => p.id === last.id)?.name).toBe('Existing')
    expect(listSkills()).toHaveLength(RECOMMENDED_SKILL_IDS.size)
    expect(getAppState('seed_version')).toBe('1')
  })
})

describe('the catalog itself', () => {
  it('has unique ids and resolvable skill attachments', () => {
    const skillIds = SEED_SKILLS.map((s) => s.id)
    const personaIds = SEED_PERSONA_TEMPLATES.map((p) => p.id)
    expect(new Set(skillIds).size).toBe(skillIds.length)
    expect(new Set(personaIds).size).toBe(personaIds.length)

    for (const persona of SEED_PERSONA_TEMPLATES) {
      for (const id of persona.skillIds) expect(skillIds).toContain(id)
    }
  })

  it('marks every recommended id as a real catalog entry', () => {
    const skillIds = new Set(SEED_SKILLS.map((s) => s.id))
    const personaIds = new Set(SEED_PERSONA_TEMPLATES.map((p) => p.id))
    for (const id of RECOMMENDED_SKILL_IDS) expect(skillIds).toContain(id)
    for (const id of RECOMMENDED_PERSONA_IDS) expect(personaIds).toContain(id)
  })

  it('grants no seeded persona full sandbox access or any MCP server', () => {
    // A seeded persona must earn nothing by default — and full_access would
    // collide with the scope pairing rule enforced on write.
    for (const persona of SEED_PERSONA_TEMPLATES) {
      expect(persona.sandbox).not.toBe('full_access')
      expect(persona.mcpServerIds).toEqual([])
      expect(persona.model).toBeNull()
    }
  })

  it('uses parseable hex colors, so the bot avatars can tint', () => {
    for (const persona of SEED_PERSONA_TEMPLATES) {
      expect(persona.avatarColor).toMatch(/^#[0-9a-f]{6}$/i)
    }
  })
})

describe('starterCatalog', () => {
  it('flags installed rows against the live database', () => {
    seedIfNeeded()
    const catalog = starterCatalog()

    const reviewer = catalog.personas.find((p) => p.entry.id === 'persona-code-reviewer')
    const hunter = catalog.personas.find((p) => p.entry.id === 'persona-bug-hunter')
    expect(reviewer).toMatchObject({ recommended: true, installed: true })
    expect(hunter).toMatchObject({ recommended: false, installed: false })
  })
})

describe('applyStarterSelection', () => {
  it('installs the selection plus the skills its personas require', () => {
    applyStarterSelection(['persona-bug-hunter'], [])

    expect(listPersonaTemplates().map((p) => p.id)).toEqual(['persona-bug-hunter'])
    // Not picked, but Bug Hunter attaches them — installed anyway, or the
    // persona would inject less than its editor claims.
    expect(new Set(listSkills().map((s) => s.id))).toEqual(
      new Set(['skill-security-checklist', 'skill-review-etiquette'])
    )
  })

  it('is idempotent', () => {
    applyStarterSelection(['persona-code-reviewer'], ['skill-api-design'])
    const counts = applyStarterSelection(['persona-code-reviewer'], ['skill-api-design'])

    expect(counts).toEqual({ personas: 0, skills: 0 })
    expect(listPersonaTemplates()).toHaveLength(1)
  })

  it('rejects ids that are not in the catalog', () => {
    expect(() => applyStarterSelection(['persona-invented'], [])).toThrow(/not in the starter/i)
    expect(() => applyStarterSelection([], ['skill-invented'])).toThrow(/not in the starter/i)
  })

  it('records that seeding happened', () => {
    applyStarterSelection([], [])
    expect(getAppState('seed_version')).toBe('1')
  })

  it('removes a deselected catalog persona that nothing is bound to', () => {
    seedIfNeeded()
    applyStarterSelection(['persona-code-reviewer'], [...RECOMMENDED_SKILL_IDS])
    expect(listPersonaTemplates().map((p) => p.id)).toEqual(['persona-code-reviewer'])
  })

  it('keeps a deselected persona while a contact is bound to it', () => {
    seedIfNeeded()
    db.run(`insert into groups (id, repo_path) values ('g1', '~/code/app')`)
    db.run(
      `insert into contacts (id, persona_template_id, repo_path, display_name)
       values ('c1', 'persona-docs-writer', '~/code/app', 'Docs Writer · app')`
    )

    applyStarterSelection(['persona-code-reviewer'], [...RECOMMENDED_SKILL_IDS])

    expect(
      listPersonaTemplates()
        .map((p) => p.id)
        .sort()
    ).toEqual(['persona-code-reviewer', 'persona-docs-writer'])
  })

  it('keeps a deselected skill that a surviving persona still attaches', () => {
    seedIfNeeded()
    // Deselect security-checklist but keep Code Reviewer, which attaches it.
    applyStarterSelection(
      ['persona-code-reviewer'],
      ['skill-typescript-style', 'skill-conventional-commits']
    )

    expect(listSkills().map((s) => s.id)).toContain('skill-security-checklist')
  })

  it('never touches user-created rows', () => {
    db.run(
      `insert into skills (id, name, description, content) values ('mine', 'My Skill', '', '')`
    )
    applyStarterSelection([], [])
    expect(listSkills().map((s) => s.id)).toContain('mine')
  })
})
