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
