import { eq, inArray } from 'drizzle-orm'
import { initDb } from '../db'
import { appState, contacts, personaTemplates, skills } from '../db/schema'
import {
  RECOMMENDED_PERSONA_IDS,
  RECOMMENDED_SKILL_IDS,
  SEED_PERSONA_TEMPLATES,
  SEED_SKILLS
} from '../db/seed-data'
import { getAppState } from './app-state'
import type { PersonaTemplate, Skill } from '../../shared/domain'

/**
 * The seed the current build would apply. Bumping this is how a future release
 * adds new defaults; the check below would then need to become a comparison
 * rather than a presence test, and to only insert what's new.
 */
const SEED_VERSION = '1'

/**
 * Inserts the first-run skills and persona templates, once ever — the
 * RECOMMENDED tier only. The wider catalog is opt-in through the onboarding
 * picker and the starter library (applyStarterSelection below); startup never
 * installs it uninvited.
 *
 * Guarded on the `seed_version` marker rather than on the tables being empty.
 * That distinction is the whole point: a user who deletes every seeded skill
 * has made a decision, and an emptiness check would silently undo it on the
 * next launch. The marker records that seeding *happened*, not what survived.
 *
 * Safe to call on every startup. Runs in one transaction, and the marker is
 * written inside it, so a crash mid-seed leaves the database untouched and
 * unmarked rather than half-populated and marked done.
 */
export function seedIfNeeded(): void {
  if (getAppState('seed_version') !== null) return

  initDb().transaction((tx) => {
    // onConflictDoNothing so a stable seed id that somehow already exists (a
    // hand-restored database, a partially migrated profile) is left alone
    // rather than aborting the whole transaction.
    for (const skill of SEED_SKILLS.filter((s) => RECOMMENDED_SKILL_IDS.has(s.id))) {
      tx.insert(skills).values(skill).onConflictDoNothing().run()
    }
    for (const persona of SEED_PERSONA_TEMPLATES.filter((p) => RECOMMENDED_PERSONA_IDS.has(p.id))) {
      tx.insert(personaTemplates).values(persona).onConflictDoNothing().run()
    }
    // Written through `tx`, not setAppState(). better-sqlite3 transactions run
    // on the same connection so either would land inside the transaction, but
    // relying on that is the kind of thing that quietly stops being true.
    tx.insert(appState)
      .values({ key: 'seed_version', value: SEED_VERSION })
      .onConflictDoUpdate({ target: appState.key, set: { value: SEED_VERSION } })
      .run()
  })
}

export interface CatalogEntry<T> {
  entry: T
  recommended: boolean
  /** A row with this id exists right now — however it got there. */
  installed: boolean
}

export interface StarterCatalog {
  personas: CatalogEntry<PersonaTemplate>[]
  skills: CatalogEntry<Skill>[]
}

/** The full catalog, flagged against what is actually in the database. */
export function starterCatalog(): StarterCatalog {
  const db = initDb()
  const skillIds = new Set(
    db
      .select({ id: skills.id })
      .from(skills)
      .all()
      .map((row) => row.id)
  )
  const personaIds = new Set(
    db
      .select({ id: personaTemplates.id })
      .from(personaTemplates)
      .all()
      .map((row) => row.id)
  )

  return {
    personas: SEED_PERSONA_TEMPLATES.map((entry) => ({
      entry,
      recommended: RECOMMENDED_PERSONA_IDS.has(entry.id),
      installed: personaIds.has(entry.id)
    })),
    skills: SEED_SKILLS.map((entry) => ({
      entry,
      recommended: RECOMMENDED_SKILL_IDS.has(entry.id),
      installed: skillIds.has(entry.id)
    }))
  }
}

/**
 * Aligns the installed starter content with a selection.
 *
 * Only catalog ids are ever touched — user-created personas and skills are
 * outside this function's vocabulary entirely, and an id it does not recognise
 * is an error, not a hint. Selected entries are inserted if missing; deselected
 * *catalog* entries are removed only when removal is safe: a persona with
 * bound contacts stays (deleting it would strand them — the same rule
 * personas.delete enforces), and a skill still attached to any persona stays,
 * because deleting it would silently strip instructions from personas the user
 * kept.
 *
 * Skills required by a selected persona are included whether or not they were
 * picked — a persona whose skillIds point at nothing would silently inject
 * less than its editor claims.
 *
 * One transaction, and the seed marker is written inside it: a fresh install
 * that completes onboarding through the picker has seeded, by definition.
 */
export function applyStarterSelection(
  selectedPersonaIds: string[],
  selectedSkillIds: string[]
): { personas: number; skills: number } {
  const personaById = new Map(SEED_PERSONA_TEMPLATES.map((p) => [p.id, p]))
  const skillById = new Map(SEED_SKILLS.map((s) => [s.id, s]))

  const unknown = [
    ...selectedPersonaIds.filter((id) => !personaById.has(id)),
    ...selectedSkillIds.filter((id) => !skillById.has(id))
  ]
  if (unknown.length > 0) {
    throw new Error(`Not in the starter library: ${unknown.join(', ')}`)
  }

  const wantPersonas = new Set(selectedPersonaIds)
  const wantSkills = new Set(selectedSkillIds)
  for (const personaId of wantPersonas) {
    for (const skillId of personaById.get(personaId)?.skillIds ?? []) wantSkills.add(skillId)
  }

  let personasInstalled = 0
  let skillsInstalled = 0

  initDb().transaction((tx) => {
    for (const skillId of wantSkills) {
      const inserted = tx
        .insert(skills)
        .values(skillById.get(skillId) as Skill)
        .onConflictDoNothing()
        .run()
      skillsInstalled += inserted.changes
    }
    for (const personaId of wantPersonas) {
      const inserted = tx
        .insert(personaTemplates)
        .values(personaById.get(personaId) as PersonaTemplate)
        .onConflictDoNothing()
        .run()
      personasInstalled += inserted.changes
    }

    // Deselected catalog personas, minus the ones something is bound to.
    const removablePersonaIds = [...personaById.keys()].filter((id) => !wantPersonas.has(id))
    if (removablePersonaIds.length > 0) {
      const bound = new Set(
        tx
          .select({ id: contacts.personaTemplateId })
          .from(contacts)
          .where(inArray(contacts.personaTemplateId, removablePersonaIds))
          .all()
          .map((row) => row.id)
      )
      for (const id of removablePersonaIds.filter((candidate) => !bound.has(candidate))) {
        tx.delete(personaTemplates).where(eq(personaTemplates.id, id)).run()
      }
    }

    // Deselected catalog skills, minus the ones any surviving persona attaches.
    const stillAttached = new Set(
      tx
        .select({ skillIds: personaTemplates.skillIds })
        .from(personaTemplates)
        .all()
        .flatMap((row) => row.skillIds)
    )
    for (const id of [...skillById.keys()].filter(
      (candidate) => !wantSkills.has(candidate) && !stillAttached.has(candidate)
    )) {
      tx.delete(skills).where(eq(skills.id, id)).run()
    }

    tx.insert(appState)
      .values({ key: 'seed_version', value: SEED_VERSION })
      .onConflictDoUpdate({ target: appState.key, set: { value: SEED_VERSION } })
      .run()
  })

  return { personas: personasInstalled, skills: skillsInstalled }
}
