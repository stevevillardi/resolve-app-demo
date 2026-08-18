import { randomUUID } from 'crypto'
import { asc, eq } from 'drizzle-orm'
import { initDb } from '../db'
import { toPersonaTemplate } from '../db/mappers'
import { contacts, personaTemplates } from '../db/schema'
import { assertNoActiveRun } from './run-lock'
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

/**
 * The Phase 17 scope rule, checked here as well as at the Zod boundary: under
 * full_access neither the MCP tool filter nor the shell guard runs, so a
 * narrower githubScope there is a promise nothing can keep. Existing rows were
 * normalized by migration 0010.
 */
function assertScopePairing(persona: {
  backend: string
  sandbox: string
  githubScope: string
}): void {
  if (persona.sandbox === 'full_access' && persona.githubScope !== 'full_access') {
    throw new Error(
      'A persona with full sandbox access cannot carry a narrower GitHub scope — full access bypasses the tools that would enforce it.'
    )
  }
  // Phase 24: ask_writes pauses a turn until a human answers, which needs a
  // backend whose SDK will hold the call open — Claude's canUseTool does,
  // Codex's exec channel cannot deliver an answer at all (see
  // askBeforeWritesSupported in shared/domain.ts). Refused here so no row can
  // exist that codexSandboxMode() would have to guess about.
  if (persona.sandbox === 'ask_writes' && persona.backend !== 'claude') {
    throw new Error(
      'Ask-before-writes needs a backend that can pause mid-turn for an answer, and Codex cannot — its exec channel has no way to deliver one.'
    )
  }
}

export function createPersonaTemplate(draft: PersonaTemplateDraft): PersonaTemplate {
  assertScopePairing(draft)
  const persona: PersonaTemplate = { id: randomUUID(), ...draft }
  initDb().insert(personaTemplates).values(persona).run()
  return persona
}

export function updatePersonaTemplate(persona: PersonaTemplate): PersonaTemplate {
  assertScopePairing(persona)
  const db = initDb()
  const existing = db
    .select()
    .from(personaTemplates)
    .where(eq(personaTemplates.id, persona.id))
    .get()
  if (!existing) throw new Error(`No such persona: ${persona.id}`)

  // Only the backend switch is refused, because only the backend switch races.
  // The clear below and a finishing turn's own `setBackendSessionId` write the
  // same column, and the turn writes last — so a backend changed mid-turn
  // leaves that contact holding a resume key for an SDK that has never heard of
  // it, which is the precise stranding this clear exists to prevent. Every
  // other field is read when a turn *starts*, so changing one under a running
  // turn simply applies from the next one, which is what a user would expect.
  if (existing.backend !== persona.backend) {
    assertNoActiveRun(boundContactIds(persona.id), 'changing which backend it runs on')
  }

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

/** The Contacts a change to this persona would reach. */
function boundContactIds(personaTemplateId: string): string[] {
  return initDb()
    .select({ id: contacts.id })
    .from(contacts)
    .where(eq(contacts.personaTemplateId, personaTemplateId))
    .all()
    .map((row) => row.id)
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
