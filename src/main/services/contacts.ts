import { randomUUID } from 'crypto'
import { asc, eq } from 'drizzle-orm'
import { existsSync } from 'fs'
import { initDb } from '../db'
import { toContact } from '../db/mappers'
import { contacts, personaTemplates } from '../db/schema'
import { worktreeRemove } from './git'
import { ensureGroupForRepo } from './groups'
import { activeRuns } from './run-lock'
import { plannedWorktree } from './worktrees'
import { defaultIsolation } from '../../shared/domain'
import type { Contact, ContactDraft, RepoTrust } from '../../shared/domain'

/**
 * Contact records (blueprint §4): one persona template bound to one repo.
 *
 * Read and create only until Phase 12, which added delete because a Contact now
 * owns something outside the database — its worktree — and nothing else can
 * clean that up. Deleting is not symmetrical with creating: the FK cascades take
 * the 1:1 thread and routines with it, while `group_messages.contact_id` and
 * `usage_events.contact_id` are `set null` so the Group's history and the record
 * of what was spent both survive their author.
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
      branch: planned?.branch ?? null,
      // A new Contact trusts nothing its repository says. Granting that is a
      // separate, deliberate act taken with the text on screen — see
      // repoTrustSchema in shared/domain.ts.
      repoTrust: null
    }

    ensureGroupForRepo(contact.repoPath, tx)
    tx.insert(contacts).values(contact).run()

    return contact
  })
}

/**
 * Deletes a Contact, and the worktree it owns.
 *
 * The worktree goes first: the row is the only thing that knows where it is, so
 * deleting in the other order would strand a directory nothing can find again.
 *
 * Refuses by default when the worktree has uncommitted work. Committed work is
 * never at risk — `git worktree remove` leaves the branch, and the Branches
 * panel is where a human decides what to do with it — but uncommitted changes
 * exist nowhere else, and silently discarding them on a delete that was only
 * meant to tidy up a Contact is not a recoverable mistake. `discardUncommitted`
 * is how the caller says it asked.
 */
export async function deleteContact(id: string, discardUncommitted = false): Promise<boolean> {
  const contact = getContact(id)
  if (!contact) return false

  if (contact.worktreePath && existsSync(contact.worktreePath)) {
    await worktreeRemove(contact.repoPath, contact.worktreePath, discardUncommitted)
  }

  // The FK cascades take this contact's thread and routines with it. Two
  // tables deliberately survive it: group_messages.contact_id is `set null`, so
  // the Group's history outlives its author, and so is usage_events, because
  // spend is a record of money that was actually spent and deleting a Contact
  // does not make that untrue. Those rows keep their persona and repo, which
  // were copied onto them when they were written. All of it is enforced only
  // because initDb() turns foreign keys on.
  const result = initDb().delete(contacts).where(eq(contacts.id, id)).run()
  return result.changes > 0
}

/**
 * Renames a Contact. Deliberately nothing else.
 *
 * `displayName` is the only column here a human ever wants to change after the
 * fact, and it is also the only one nothing derives from. The three obvious
 * candidates for a general `updateContact` are all load-bearing:
 *
 * - `repoPath` is the Group key (§4's one Group per repo), the run-lock key via
 *   workingPathFor(), and the directory the backend session was opened against.
 * - `worktreePath` and `branch` are derived from the repo and persona at bind
 *   time and are pointed at by a real checkout on disk.
 * - `personaTemplateId` decides the backend, so changing it would strand
 *   `backendSessionId` on an SDK that has never heard of it.
 *
 * Changing any of them would silently orphan a live worktree and a live
 * session. A Contact bound to the wrong thing is deleted and made again, which
 * is what deleteContact's worktree cleanup exists for. Keeping the input at
 * `{ id, displayName }` puts that constraint at the Zod boundary rather than in
 * a service-level check somebody can forget to write.
 */
export function renameContact(id: string, displayName: string): Contact {
  const trimmed = displayName.trim()
  if (trimmed.length === 0) throw new Error('A contact needs a name.')

  const result = initDb()
    .update(contacts)
    .set({ displayName: trimmed })
    .where(eq(contacts.id, id))
    .run()

  if (result.changes === 0) throw new Error(`No such contact: ${id}`)

  // Re-read rather than patching the caller's copy: listContacts orders by
  // display_name, so the row's place in the list has just moved and the caller
  // should be looking at what is actually stored.
  return getContact(id) as Contact
}

/**
 * What this Contact lets its repository say to it (blueprint §4, Phase 14).
 *
 * The only writer of `repo_trust`, and the only way any of it turns on: a new
 * Contact is created with `repoTrust: null`, which `repoTrustOf()` reads as
 * nothing trusted, and until a human calls this the repository's `CLAUDE.md`
 * and every skill it ships stay unreachable no matter what the persona is
 * allowed to do elsewhere.
 *
 * Its own procedure rather than a field on renameContact for the reason that
 * one is narrow: these are different decisions with different consequences, and
 * a single permissive contact update would make it possible to change trust as
 * a side effect of a rename.
 *
 * **An allowlist of skill names, not a boolean.** A human approves the skills
 * that were in the repository when they looked; one committed afterwards has
 * not been approved by anybody and must not inherit it. That is why this stores
 * names and `capabilitiesFor` intersects them with what is on disk, rather than
 * storing "trust this repo's skills" and resolving it later.
 */
export function setRepoTrust(id: string, trust: RepoTrust): Contact {
  const result = initDb()
    .update(contacts)
    .set({ repoTrust: trust })
    .where(eq(contacts.id, id))
    .run()

  if (result.changes === 0) throw new Error(`No such contact: ${id}`)

  return getContact(id) as Contact
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

/**
 * Moves a Contact to another persona (Phase 17).
 *
 * The one binding change that can be made safe, so it is. What makes repoPath
 * immutable — the Group key, the run-lock key, a checkout on disk — does not
 * apply here: nothing on disk is keyed by the persona, and the only stale
 * thing a rebind leaves behind is the resume key, which is cleared in the same
 * transaction (the new persona may live on the other backend, and a session id
 * is an index into one SDK's storage). History, worktree and spend all stay.
 *
 * Refused while a turn is running: rebinding under a live stream would change
 * who is speaking mid-sentence, and the finishing turn would then write its
 * session id onto a contact that no longer means the same thing.
 */
export function rebindContactPersona(id: string, personaTemplateId: string): Contact {
  const db = initDb()
  const contact = getContact(id)
  if (!contact) throw new Error(`No such contact: ${id}`)

  if (activeRuns().some((run) => run.contactId === id)) {
    throw new Error(
      'This contact is working right now. Wait for the turn to finish, or stop it first.'
    )
  }

  const persona = db
    .select()
    .from(personaTemplates)
    .where(eq(personaTemplates.id, personaTemplateId))
    .get()
  if (!persona) throw new Error(`No such persona: ${personaTemplateId}`)

  db.transaction((tx) => {
    tx.update(contacts)
      .set({ personaTemplateId, backendSessionId: null })
      .where(eq(contacts.id, id))
      .run()
  })

  return getContact(id) as Contact
}

/**
 * Forgets the resume key, so the next turn starts a fresh backend session.
 *
 * The transcript lives in this database, not in the vendor's session storage —
 * so clearing this loses nothing the user can see, only the backend's working
 * memory of the thread. Called when the key is known to be dead (the backend
 * refused to resume it) or about to be (the persona is moving to a backend
 * that has never heard of it).
 */
export function clearBackendSessionId(id: string): void {
  initDb().update(contacts).set({ backendSessionId: null }).where(eq(contacts.id, id)).run()
}
