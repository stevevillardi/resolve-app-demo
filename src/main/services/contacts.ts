import { randomUUID } from 'crypto'
import { asc, eq } from 'drizzle-orm'
import { existsSync } from 'fs'
import { initDb } from '../db'
import { toContact } from '../db/mappers'
import { contacts, personaTemplates } from '../db/schema'
import { worktreeRemove } from './git'
import { ensureGroupForRepo } from './groups'
import { assertNoActiveRun } from './run-lock'
import { plannedWorktree } from './worktrees'
import { defaultIsolation, isolationOf } from '../../shared/domain'
import type { Contact, ContactDraft, Isolation, RepoTrust } from '../../shared/domain'

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
      repoTrust: null,
      // Born read: a thread with no messages has nothing unread in it.
      lastReadAt: Date.now()
    }

    ensureGroupForRepo(contact.repoPath, tx)
    tx.insert(contacts)
      .values({ ...contact, lastReadAt: new Date(contact.lastReadAt as number) })
      .run()

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
 *
 * Refused while this Contact is mid-turn, and this is the sharpest of the three
 * guards: the worktree removal below would pull the directory out from under a
 * live session, and the row deletion would land just before that turn's `finish`
 * inserts a reply against it — a foreign-key failure raised inside a `finally`,
 * which is about the worst place in the turn loop to raise anything.
 */
export async function deleteContact(id: string, discardUncommitted = false): Promise<boolean> {
  const contact = getContact(id)
  if (!contact) return false

  assertNoActiveRun([id], 'deleting it')

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
 * fact *and* that nothing derives from. Of the rest:
 *
 * - `repoPath` is the Group key (§4's one Group per repo), the run-lock key via
 *   workingPathFor(), and the directory the backend session was opened against.
 *   Still immutable; its remedy is still delete-and-recreate.
 * - `personaTemplateId` decides the backend, so changing it would strand
 *   `backendSessionId` on an SDK that has never heard of it — which is why it
 *   has its own procedure, `rebindContactPersona`, that clears the key.
 * - `isolation`, and with it `worktreePath`/`branch`, was on this list until
 *   Phase 22 and is now `setContactIsolation` below. The argument that put it
 *   here — a real checkout on disk points at it — turned out to be weaker than
 *   it sounded, because the checkout is created lazily on the first writing
 *   turn rather than at bind time.
 *
 * Keeping this input at `{ id, displayName }` puts the remaining constraints at
 * the Zod boundary rather than in a service check somebody can forget to write.
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
 * Moves a Contact between working in the repo and working in its own checkout
 * (Phase 22).
 *
 * This was documented as immutable in four places, and the argument was that a
 * real checkout on disk points at these columns. `ensureWorktree` is why that
 * turned out to be weaker than it sounded: the directory is created on the
 * first *writing turn*, not at bind time, so the row is the only durable thing
 * and the disk follows it.
 *
 * **shared/exclusive → worktree** writes the planned path and branch and stops.
 * `plannedWorktree` is deterministic from (repo, persona, contact id), so a
 * Contact that has been isolated before gets its own path and branch back, and
 * `worktreeAdd` reuses an existing branch rather than failing — so a round trip
 * lands back on the same work rather than stranding it. Uncommitted work in the
 * main tree stays in the main tree: the new branch is cut from HEAD, and
 * anything half-finished is left where the user can still see it.
 *
 * **worktree → shared/exclusive** has to remove a real directory, so it takes
 * `deleteContact`'s posture rather than inventing a second one: refused when
 * the worktree is dirty unless the caller explicitly discards. `branch` is kept
 * on purpose even though `worktreePath` goes — `git worktree remove` leaves the
 * branch and its commits, and the Branches panel attributes a branch to a
 * Contact by matching this column, so nulling it would turn the Contact's own
 * committed work into an orphan the moment it de-isolated. That makes `branch`
 * outlive `worktreePath`, which the schema comment used to say was impossible;
 * both comments are updated.
 *
 * Both directions clear the resume key. The session was opened against a
 * working directory that no longer applies, which is the same reasoning
 * `rebindContactPersona` uses — and since Phase 22 the thread draws a divider
 * where that happens, so the consequence is visible rather than mysterious.
 */
export async function setContactIsolation(
  id: string,
  isolation: Isolation,
  discardUncommitted = false
): Promise<Contact> {
  const contact = getContact(id)
  if (!contact) throw new Error(`No such contact: ${id}`)
  if (isolationOf(contact.isolation) === isolation) return contact

  // Load-bearing rather than defensive: the run lock is keyed on
  // workingPathFor(contact), so moving it under a holder would leave that
  // holder's release looking for a slot that no longer exists.
  assertNoActiveRun([id], 'changing where it works')

  if (isolation === 'worktree') {
    const persona = initDb()
      .select()
      .from(personaTemplates)
      .where(eq(personaTemplates.id, contact.personaTemplateId))
      .get()
    if (!persona) throw new Error(`No such persona: ${contact.personaTemplateId}`)

    const planned = plannedWorktree(contact.repoPath, persona.name, contact.id)
    initDb()
      .update(contacts)
      .set({
        isolation,
        worktreePath: planned.path,
        branch: planned.branch,
        backendSessionId: null
      })
      .where(eq(contacts.id, id))
      .run()

    return getContact(id) as Contact
  }

  // Leaving a worktree. The directory goes; the branch does not.
  if (contact.worktreePath && existsSync(contact.worktreePath)) {
    await worktreeRemove(contact.repoPath, contact.worktreePath, discardUncommitted)
  }

  initDb()
    .update(contacts)
    .set({ isolation, worktreePath: null, backendSessionId: null })
    .where(eq(contacts.id, id))
    .run()

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
/**
 * Stamps the unread boundary (Phase 20). Narrow on purpose, like setRepoTrust
 * below and for the same reason. Monotonic and idempotent: a stale caller —
 * two mounted views racing, an out-of-order invalidation — can never move the
 * boundary *backwards* and resurrect read messages as unread, and a no-op
 * write is skipped entirely so mark-read cannot ping-pong with the
 * messages-changed invalidations it triggers.
 */
export function markContactRead(id: string, at = Date.now()): Contact {
  const contact = getContact(id)
  if (!contact) throw new Error(`No such contact: ${id}`)
  if (contact.lastReadAt !== null && at <= contact.lastReadAt) return contact

  initDb()
    .update(contacts)
    .set({ lastReadAt: new Date(at) })
    .where(eq(contacts.id, id))
    .run()
  return { ...contact, lastReadAt: at }
}

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

  assertNoActiveRun([id], 'changing its persona')

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

/**
 * The user asking for the same thing on purpose (Phase 22).
 *
 * Until now a fresh session was only ever a side effect — of a dead key
 * healing, or of changing persona — which left the one lever over session cost
 * reachable only by pretending to want something else. Every turn is billed for
 * the whole conversation it can see (this repo measured a Codex thread going
 * 12k → 25k → 39k input tokens across three one-word turns), and this is the
 * remedy for that, so it has to be askable directly.
 *
 * Exactly one column changes. The thread, the worktree, the branch, the spend
 * and the persona all stay — the visible conversation is ours and is not what
 * the backend is forgetting. Idempotent, because a contact with no session has
 * already got what this offers.
 *
 * Refused mid-turn for the same reason the backend switch is: a turn finishing
 * a moment later writes its own session id back over the clear, so the request
 * would appear to succeed and silently not happen.
 */
export function startFreshSession(id: string): Contact {
  const contact = getContact(id)
  if (!contact) throw new Error(`No such contact: ${id}`)
  if (!contact.backendSessionId) return contact

  assertNoActiveRun([id], 'starting a fresh session')
  clearBackendSessionId(id)

  return getContact(id) as Contact
}
