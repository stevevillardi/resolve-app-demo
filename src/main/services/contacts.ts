import { randomUUID } from 'crypto'
import { asc, eq } from 'drizzle-orm'
import { initDb } from '../db'
import { toContact } from '../db/mappers'
import { contacts, personaTemplates } from '../db/schema'
import { ensureGroupForRepo } from './groups'
import { defaultIsolation, plannedWorktree } from './worktrees'
import type { Contact, ContactDraft } from '../../shared/domain'

/**
 * Contact records (blueprint §4): one persona template bound to one repo.
 *
 * Read and create only until Phase 12, which added delete because a Contact now
 * owns something outside the database — its worktree — and nothing else can
 * clean that up. Deleting is not symmetrical with creating: the FK cascades take
 * the 1:1 thread, routines and usage with it, while `group_messages.contact_id`
 * is `set null` so the Group's history survives its author.
 */

export function listContacts(): Contact[] {
  return initDb().select().from(contacts).orderBy(asc(contacts.displayName)).all().map(toContact)
}

export function getContact(id: string): Contact | null {
  const row = initDb().select().from(contacts).where(eq(contacts.id, id)).get()
  return row ? toContact(row) : null
}

/**
 * Creates the contact and, atomically, the repo's Group if it's the first one
 * bound there — blueprint §4's "one Group per repo" holds from the first
 * contact rather than being reconciled later.
 *
 * `backendSessionId` starts null: there is no session until the first turn
 * actually runs (Phase 6).
 *
 * The worktree path and branch are derived here rather than taken from the
 * draft, because a caller-supplied working path would be a way to point a
 * session at any directory on disk — the one thing the sandbox levels exist to
 * prevent. They name a directory that does not exist yet; it is created on the
 * first writing turn (Phase 12).
 */
export function createContact(draft: ContactDraft): Contact {
  const id = randomUUID()

  return initDb().transaction((tx) => {
    const persona = tx
      .select()
      .from(personaTemplates)
      .where(eq(personaTemplates.id, draft.personaTemplateId))
      .get()

    if (!persona) throw new Error(`No such persona template: ${draft.personaTemplateId}`)

    const isolation = draft.isolation ?? defaultIsolation(persona.sandbox)
    // Only a `worktree` Contact works anywhere other than the repo itself.
    // `exclusive` deliberately runs in the main tree — it exists for the cases a
    // worktree cannot serve, like needing uncommitted work or node_modules.
    const planned =
      isolation === 'worktree' ? plannedWorktree(draft.repoPath, persona.name, id) : null

    const contact: Contact = {
      ...draft,
      id,
      backendSessionId: null,
      isolation,
      worktreePath: planned?.path ?? null,
      branch: planned?.branch ?? null
    }

    ensureGroupForRepo(contact.repoPath, tx)
    tx.insert(contacts).values(contact).run()

    return contact
  })
}

/**
 * Records the backend's resume key after a turn (Phase 6).
 *
 * Called once, after the first turn on a contact: the adapters fill
 * `AgentSession.sessionId` in mid-stream at `session_started`, so it has to be
 * read after the run rather than before it. Every later turn resumes from what
 * this wrote, which is what makes a conversation survive quitting the app.
 */
export function setBackendSessionId(id: string, backendSessionId: string): void {
  const result = initDb()
    .update(contacts)
    .set({ backendSessionId })
    .where(eq(contacts.id, id))
    .run()

  if (result.changes === 0) throw new Error(`No such contact: ${id}`)
}
