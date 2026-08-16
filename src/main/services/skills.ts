import { randomUUID } from 'crypto'
import { asc, eq } from 'drizzle-orm'
import { initDb } from '../db'
import { toSkill } from '../db/mappers'
import { personaTemplates, skills } from '../db/schema'
import type { Skill, SkillDraft } from '../../shared/domain'

/**
 * Skill library CRUD (blueprint §4). A Skill is reusable instruction text
 * referenced by id from persona templates — it has no owner and no lifecycle
 * of its own beyond this file.
 */

export function listSkills(): Skill[] {
  return initDb().select().from(skills).orderBy(asc(skills.name)).all().map(toSkill)
}

export function getSkill(id: string): Skill | null {
  const row = initDb().select().from(skills).where(eq(skills.id, id)).get()
  return row ? toSkill(row) : null
}

export function createSkill(draft: SkillDraft): Skill {
  const skill: Skill = { id: randomUUID(), ...draft }
  initDb().insert(skills).values(skill).run()
  return skill
}

export function updateSkill(skill: Skill): Skill {
  const result = initDb()
    .update(skills)
    .set({ name: skill.name, description: skill.description, content: skill.content })
    .where(eq(skills.id, skill.id))
    .run()

  if (result.changes === 0) throw new Error(`No such skill: ${skill.id}`)
  return skill
}

/**
 * Deletes a skill and detaches it from every persona that referenced it.
 *
 * Detaching rather than blocking is the deliberate choice: `skill_ids` is a
 * JSON array (§4) with no foreign key behind it, and a skill is only injected
 * text — losing one degrades a persona's instructions rather than breaking the
 * persona. Blocking would instead force the user to hand-unattach it
 * everywhere first. `SkillLibraryView` shows the "Used by" list so the blast
 * radius is visible before the click.
 *
 * Both halves run in one transaction so a crash can't leave personas pointing
 * at a skill that no longer exists.
 */
export function deleteSkill(id: string): void {
  const db = initDb()
  db.transaction((tx) => {
    for (const persona of tx.select().from(personaTemplates).all()) {
      if (!persona.skillIds.includes(id)) continue
      tx.update(personaTemplates)
        .set({ skillIds: persona.skillIds.filter((skillId) => skillId !== id) })
        .where(eq(personaTemplates.id, persona.id))
        .run()
    }
    tx.delete(skills).where(eq(skills.id, id)).run()
  })
}

/**
 * The skills a persona injects, resolved from its `skillIds` (blueprint §5).
 *
 * Adapters may not touch the database, so somebody has to turn ids into content
 * before a session starts — this is that somebody, and the messaging service is
 * its only caller. Ordering is not this function's job: composeInstructions()
 * re-orders by `persona.skillIds` itself, so only completeness matters here.
 *
 * A dangling id is skipped rather than throwing. `skill_ids` is a JSON array
 * with no foreign key behind it (see deleteSkill above), so a stale id is a
 * degraded persona, not a broken one — and failing a turn over it would be a
 * worse outcome than running with one fewer skill.
 */
export function skillsForPersona(persona: { skillIds: string[] }): Skill[] {
  if (persona.skillIds.length === 0) return []

  const byId = new Map(listSkills().map((skill) => [skill.id, skill]))
  return persona.skillIds
    .map((id) => byId.get(id))
    .filter((skill): skill is Skill => skill !== undefined)
}

/** Personas whose `skill_ids` contain this skill — the "Used by" list. */
export function personasUsingSkill(id: string): string[] {
  return initDb()
    .select()
    .from(personaTemplates)
    .all()
    .filter((persona) => persona.skillIds.includes(id))
    .map((persona) => persona.name)
}
