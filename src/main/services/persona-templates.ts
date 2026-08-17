import { randomUUID } from 'crypto'
import { asc, eq } from 'drizzle-orm'
import { initDb } from '../db'
import { toPersonaTemplate } from '../db/mappers'
import { contacts, personaTemplates } from '../db/schema'
import type { PersonaTemplate, PersonaTemplateDraft } from '../../shared/domain'

/**
 * PersonaTemplate CRUD (blueprint §4). A template is the reusable definition —
 * prompt, skills, and the two permission axes. Binding one to a repo produces
 * a Contact, which is Phase 6's job.
 */

export function listPersonaTemplates(): PersonaTemplate[] {
  return initDb()
    .select()
    .from(personaTemplates)
    .orderBy(asc(personaTemplates.name))
    .all()
    .map(toPersonaTemplate)
}

export function getPersonaTemplate(id: string): PersonaTemplate | null {
  const row = initDb().select().from(personaTemplates).where(eq(personaTemplates.id, id)).get()
  return row ? toPersonaTemplate(row) : null
}

export function createPersonaTemplate(draft: PersonaTemplateDraft): PersonaTemplate {
  const persona: PersonaTemplate = { id: randomUUID(), ...draft }
  initDb().insert(personaTemplates).values(persona).run()
  return persona
}

export function updatePersonaTemplate(persona: PersonaTemplate): PersonaTemplate {
  const db = initDb()
  const existing = db
    .select()
    .from(personaTemplates)
    .where(eq(personaTemplates.id, persona.id))
    .get()
  if (!existing) throw new Error(`No such persona: ${persona.id}`)

  db.transaction((tx) => {
    tx.update(personaTemplates)
      .set({
        name: persona.name,
        avatarColor: persona.avatarColor,
        backend: persona.backend,
        // Explicitly listed, like every other column: an omission here is a
        // silent no-op rather than a type error, which is exactly how `model`
        // went unsaved when the column was added.
        model: persona.model,
        systemPrompt: persona.systemPrompt,
        skillIds: persona.skillIds,
        mcpServerIds: persona.mcpServerIds,
        sandbox: persona.sandbox,
        githubScope: persona.githubScope
      })
      .where(eq(personaTemplates.id, persona.id))
      .run()

    // A resume key is an index into one SDK's session storage. Moving the
    // persona to the other backend would hand Codex a Claude UUID (or the
    // reverse) on every bound contact's next turn — the exact stranding hazard
    // contacts.ts documents for personaTemplateId, guarded here for `backend`.
    // In the same transaction so a failed update can't strand sessions, and a
    // cleared session can't outlive a failed backend switch. A model-only
    // change deliberately does NOT clear: both SDKs accept a model on resume.
    if (existing.backend !== persona.backend) {
      tx.update(contacts)
        .set({ backendSessionId: null })
        .where(eq(contacts.personaTemplateId, persona.id))
        .run()
    }
  })

  return persona
}

/**
 * Refuses while any Contact is bound to this persona.
 *
 * `contacts.persona_template_id` is ON DELETE RESTRICT, so SQLite would block
 * this anyway — but only with "FOREIGN KEY constraint failed", which tells the
 * user nothing about what to do. Checking first lets the message name the
 * contacts standing in the way. The constraint stays as the real guarantee;
 * this is the readable path to the same outcome.
 */
export function deletePersonaTemplate(id: string): void {
  const db = initDb()
  const bound = db.select().from(contacts).where(eq(contacts.personaTemplateId, id)).all()

  if (bound.length > 0) {
    const names = bound.map((contact) => contact.displayName).join(', ')
    throw new Error(
      `Can't delete this persona — ${bound.length} contact${bound.length === 1 ? '' : 's'} still bound to it: ${names}. Delete those first.`
    )
  }

  db.delete(personaTemplates).where(eq(personaTemplates.id, id)).run()
}
