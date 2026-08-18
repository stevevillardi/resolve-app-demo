import { randomUUID } from 'crypto'
import { asc, eq } from 'drizzle-orm'
import { initDb } from '../db'
import { toGroup } from '../db/mappers'
import { groups } from '../db/schema'
import type { AppDatabase } from '../db'
import type { Group } from '../../shared/domain'

/**
 * Groups (blueprint §4, §8). One per repo, created implicitly the first time a
 * Contact binds to that repo — never by the user directly, which is why there
 * is no create procedure on the IPC contract.
 *
 * A Group has no backend session of its own; it's a merged view and a router.
 */

export function listGroups(): Group[] {
  return initDb().select().from(groups).orderBy(asc(groups.repoPath)).all().map(toGroup)
}

/**
 * Returns the repo's group, creating it if this is the first contact bound
 * there. Takes an optional db handle so contact creation can run it inside the
 * same transaction rather than leaving a group behind if the contact insert
 * then fails.
 *
 * `onConflictDoNothing` against the unique index on repo_path, rather than
 * check-then-insert: the check-then-insert version has a race between the two
 * statements that the unique index would turn into a hard constraint error.
 */
export function ensureGroupForRepo(repoPath: string, db: AppDatabase = initDb()): Group {
  db.insert(groups)
    // Born read, same as createContact.
    .values({ id: randomUUID(), repoPath, lastReadAt: new Date() })
    .onConflictDoNothing({ target: groups.repoPath })
    .run()

  const row = db.select().from(groups).where(eq(groups.repoPath, repoPath)).get()
  if (!row) throw new Error(`Failed to create group for repo: ${repoPath}`)
  return toGroup(row)
}

/**
 * The groups table's first write since its creation. Same monotonic,
 * idempotent contract as markContactRead — see that comment.
 */
export function markGroupRead(id: string, at = Date.now()): Group {
  const row = initDb().select().from(groups).where(eq(groups.id, id)).get()
  if (!row) throw new Error(`No such group: ${id}`)

  const current = toGroup(row)
  if (current.lastReadAt !== null && at <= current.lastReadAt) return current

  initDb()
    .update(groups)
    .set({ lastReadAt: new Date(at) })
    .where(eq(groups.id, id))
    .run()
  return { ...current, lastReadAt: at }
}

/**
 * Rename a group, or clear the override with null (review §G5).
 *
 * A group's name has always been derived from its repository path, and this
 * makes that a default rather than a fact — see the `name` column comment.
 * Passing null is a real operation, not a missing argument: it is how a rename
 * is undone, which is why there is no separate "reset" procedure beside this
 * one.
 *
 * Trimming happens at the Zod boundary (`groups.rename` uses the same
 * `.trim().min(1)` shape `contacts.update` does), so an empty string cannot
 * arrive here and be stored as a name that renders blank.
 */
export function renameGroup(id: string, name: string | null): Group {
  const row = initDb().select().from(groups).where(eq(groups.id, id)).get()
  if (!row) throw new Error(`No such group: ${id}`)

  initDb().update(groups).set({ name }).where(eq(groups.id, id)).run()
  return { ...toGroup(row), name }
}

/**
 * Hide a group from the conversation list, or bring it back.
 *
 * Deliberately not a delete, and there is no delete to fall back on: a group is
 * a *view* of the contacts bound to a repository, so removing the row while
 * those contacts exist would only mean `ensureGroupForRepo` recreating it on
 * the next turn — with its `last_read_at` reset, which would light up every
 * message in it as unread. Hiding changes what is listed and nothing else.
 */
export function setGroupHidden(id: string, hidden: boolean): Group {
  const row = initDb().select().from(groups).where(eq(groups.id, id)).get()
  if (!row) throw new Error(`No such group: ${id}`)

  initDb().update(groups).set({ hidden }).where(eq(groups.id, id)).run()
  return { ...toGroup(row), hidden }
}
