import { isNotNull } from 'drizzle-orm'
import { app } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'
import { initDb } from '../db'
import { contacts } from '../db/schema'
import { gitWritePathsFor, worktreeAdd, worktreePrune } from './git'
import type { Contact, Isolation, SandboxLevel } from '../../shared/domain'

/**
 * Where each Contact works, and what its branch is called.
 *
 * Worktrees live under the app's own data directory rather than beside the
 * user's repo (docs/plan/12-worktree-isolation.md): the user's checkout and its
 * parent directory stay untouched, orphans are enumerable from one root, and a
 * reset of the profile takes the worktrees with it. The names are readable
 * rather than uuids so the directory is still navigable by a human:
 *
 *     <userData>/worktrees/<repo-name>/<persona-slug>-<short-id>
 *
 * Split in two on purpose. Naming is pure and synchronous, because the path is
 * *planned* when the Contact is created — before any git command has run, and
 * before the directory exists — so that workingPathFor() stays a pure function
 * of the row. Materialising is async and lives below it, because it runs git.
 * See the worktree_path comment in src/main/db/schema.ts for why the two are
 * separated at all.
 */

export const WORKTREE_DIR = 'worktrees'

export function worktreeRoot(): string {
  return join(app.getPath('userData'), WORKTREE_DIR)
}

export interface PlannedWorktree {
  path: string
  branch: string
}

/**
 * The directory and branch a Contact would use, derived rather than stored.
 *
 * Deterministic in all three inputs so it can be computed synchronously at
 * create time, before any git command has run. The short id disambiguates two
 * Contacts that put the same persona on the same repo, which is otherwise a
 * collision on both the path and the branch — and git refuses outright to check
 * one branch out into two worktrees, so a collision would be a hard failure
 * rather than a quiet mix-up.
 */
export function plannedWorktree(
  repoPath: string,
  personaName: string,
  contactId: string
): PlannedWorktree {
  const repo = slug(basename(repoPath)) || 'repo'
  const persona = slug(personaName) || 'persona'
  const name = `${persona}-${shortId(contactId)}`

  return { path: join(worktreeRoot(), repo, name), branch: `persona/${name}` }
}

/**
 * What a new Contact gets when the bind flow doesn't say.
 *
 * Readers stay in the main tree: they are never refused by the run lock anyway,
 * and the main tree is the only place uncommitted work is visible — which is
 * usually the thing a reviewer was asked to look at. Writers are the ones that
 * contend, so they are the ones that get isolated.
 *
 * A repo that is not a git repo cannot be isolated at all; the bind flow is
 * responsible for choosing `exclusive` there, because it is the only layer that
 * can ask git the question before the Contact exists.
 */
export function defaultIsolation(sandbox: SandboxLevel): Isolation {
  return sandbox === 'read_only' ? 'shared' : 'worktree'
}

/** Null reads as `shared` — that is what every pre-0007 row means. */
export function isolationOf(isolation: Isolation | null): Isolation {
  return isolation ?? 'shared'
}

/**
 * Clears registrations for worktrees whose directories are gone.
 *
 * Run at startup because the app is not the only thing that can delete a
 * directory. git keeps a prunable registration until told otherwise, and while
 * one exists the branch is still "checked out somewhere" — which would make
 * re-creating that Contact's worktree fail with a message about a worktree the
 * user already deleted.
 *
 * Pruning never destroys work: the branch and its commits survive, which is what
 * makes deleting a worktree by hand a recoverable thing to have done.
 *
 * Failures are logged, not thrown. A repo that has been moved or unmounted since
 * the Contact was created must not stop the app from starting.
 */
export async function pruneOrphanedWorktrees(
  repoPaths: string[] = repoPathsWithWorktrees()
): Promise<void> {
  for (const repoPath of repoPaths) {
    try {
      await worktreePrune(repoPath)
    } catch (error) {
      console.warn(`[worktrees] could not prune ${repoPath}:`, error)
    }
  }
}

/** The repos that have at least one isolated Contact, deduplicated. */
function repoPathsWithWorktrees(): string[] {
  const rows = initDb()
    .select({ repoPath: contacts.repoPath })
    .from(contacts)
    .where(isNotNull(contacts.worktreePath))
    .all()

  return [...new Set(rows.map((row) => row.repoPath))]
}

/**
 * Creates the Contact's worktree if it does not exist yet, and returns the
 * directories its session must be able to write to outside its own.
 *
 * Called on every turn rather than at bind time, so a Contact that is created
 * and never used costs no checkout. It is cheap when there is nothing to do:
 * one `existsSync` for a Contact in the main tree.
 *
 * Failure is deliberately loud. The alternative — quietly running in the main
 * tree when the worktree could not be made — would take a Contact the user
 * isolated on purpose and put it back in the directory they were protecting,
 * without the run lock knowing, because the lock key was decided from the row.
 */
export async function ensureWorktree(contact: Contact): Promise<string[]> {
  const { repoPath, worktreePath, branch } = contact
  if (isolationOf(contact.isolation) !== 'worktree') return []
  if (!worktreePath || !branch) return []

  // The marker is `.git` rather than the directory: a worktree is only usable
  // if git still knows about it, and an empty directory left behind by a failed
  // attempt would otherwise read as ready.
  if (!existsSync(join(worktreePath, '.git'))) {
    await worktreeAdd(repoPath, worktreePath, branch)
  }

  return gitWritePathsFor(worktreePath)
}

/**
 * Lowercase, alphanumeric, single dashes.
 *
 * Deliberately strict rather than merely git-legal: it has to produce both a
 * path component and a branch name. Collapsing everything else to a dash rules
 * out the ref-format traps in one go — `git check-ref-format` rejects spaces and
 * `..`, so "Code Reviewer" and "weird..name" would both fail unbranded.
 */
function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** Enough uuid to disambiguate, short enough to keep the directory readable. */
function shortId(contactId: string): string {
  return (
    contactId
      .replace(/[^a-z0-9]/gi, '')
      .slice(0, 4)
      .toLowerCase() || '0000'
  )
}

/** basename() without importing the whole path module's platform behaviour. */
function basename(value: string): string {
  const parts = value.split(/[\\/]+/).filter(Boolean)
  return parts[parts.length - 1] ?? ''
}
