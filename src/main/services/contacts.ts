import { randomUUID } from 'crypto'
import { asc, eq } from 'drizzle-orm'
import { initDb } from '../db'
import { toContact } from '../db/mappers'
import { contacts } from '../db/schema'
import { ensureGroupForRepo } from './groups'
import type { Contact, ContactDraft } from '../../shared/domain'

/**
 * Contact records (blueprint §4): one persona template bound to one repo.
 *
 * Read and create only. Everything that makes a contact *live* — starting a
 * session, populating `backendSessionId`, sending messages — is Phase 6, and
 * so is the UI that calls create (`NewContactFlow`). This exists now so the
 * persona and group relationships have something real to hang off.
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
 */
export function createContact(draft: ContactDraft): Contact {
  const contact: Contact = { id: randomUUID(), ...draft, backendSessionId: null }

  initDb().transaction((tx) => {
    ensureGroupForRepo(contact.repoPath, tx)
    tx.insert(contacts).values(contact).run()
  })

  return contact
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
