import { and, eq, isNotNull, ne } from 'drizzle-orm'
import { app } from 'electron'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { initDb } from '../db'
import { contacts } from '../db/schema'
import { recordAuditEvent, type AuditActor } from './audit-events'
import {
  changedFiles,
  currentBranch,
  gitWritePathsFor,
  headSha,
  worktreeAdd,
  worktreePrune
} from './git'
import type { SiblingBranch } from '../adapters/types'
import { isolationOf } from '../../shared/domain'
import type { Contact } from '../../shared/domain'

/**
 * Where each Contact works, and what its branch is called.
 *
 * Worktrees live under the app's own data directory rather than beside the
 * user's repo: the user's checkout and its parent directory stay untouched,
 * orphans are enumerable from one root, and a reset of the profile takes the
 * worktrees with it. The names are readable rather than uuids so the directory
 * is still navigable by a human:
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

/**
 * Every branch this app creates lives under here, which is what lets the
 * Branches panel enumerate them without a database and so still find the ones
 * whose Contact has been deleted.
 */
export const PERSONA_BRANCH_PREFIX = 'persona/'

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

  return { path: join(worktreeRoot(), repo, name), branch: `${PERSONA_BRANCH_PREFIX}${name}` }
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
export async function ensureWorktree(contact: Contact, actor?: AuditActor): Promise<string[]> {
  const { repoPath, worktreePath, branch } = contact
  if (isolationOf(contact.isolation) !== 'worktree') return []
  if (!worktreePath || !branch) return []

  // The marker is `.git` rather than the directory: a worktree is only usable
  // if git still knows about it, and an empty directory left behind by a failed
  // attempt would otherwise read as ready.
  if (!existsSync(join(worktreePath, '.git'))) {
    await worktreeAdd(repoPath, worktreePath, branch)

    // The checkout above already succeeded — an audit-recording failure must
    // not turn that into a loud failure of the turn that needed it.
    try {
      // Only on the branch that actually creates a checkout, not on every
      // turn this function is called for a Contact whose worktree already
      // exists — called-per-turn means an unguarded write here would
      // dominate the table's growth.
      recordAuditEvent({
        action: 'worktree_created',
        actor,
        contactId: contact.id,
        repoPath,
        personaTemplateId: contact.personaTemplateId,
        summary: `Created worktree for ${contact.displayName} on ${branch}`
      })
    } catch (error) {
      console.warn('[worktrees] could not record audit event for', contact.id, error)
    }
  }

  return gitWritePathsFor(worktreePath)
}

/**
 * The branches other Contacts on this repo are working on.
 *
 * Synchronous and git-free on purpose: it is resolved while building the session
 * spec, which happens inside the synchronous half of startTurn. The `existsSync`
 * is what keeps it honest — a Contact's branch is *planned* when it is created,
 * so listing every row would announce branches that do not exist yet.
 *
 * Excludes the session's own branch, which it can see perfectly well by being
 * checked out on it.
 */
export function siblingBranchesFor(contact: Contact): SiblingBranch[] {
  const rows = initDb()
    .select()
    .from(contacts)
    .where(and(eq(contacts.repoPath, contact.repoPath), ne(contacts.id, contact.id)))
    .all()

  return rows
    .filter((row) => row.branch && row.worktreePath && existsSync(join(row.worktreePath, '.git')))
    .map((row) => ({
      branch: row.branch as string,
      contactName: row.displayName,
      // Read from the ref file rather than by running git: this is on the
      // synchronous path, and a missing sha only costs the reader a short
      // annotation.
      headSha: refHead(contact.repoPath, row.branch as string)
    }))
}

/**
 * A branch's head, straight off disk.
 *
 * Loose refs are a file containing the sha; packed ones are not, and rather than
 * parse packed-refs this returns null and lets the annotation be omitted. The
 * branch name is the load-bearing part — worktree branches are freshly written
 * and so are loose in practice.
 */
function refHead(repoPath: string, branch: string): string | null {
  try {
    const sha = readFileSync(join(repoPath, '.git', 'refs', 'heads', branch), 'utf8').trim()
    return /^[0-9a-f]{40}$/.test(sha) ? sha : null
  } catch {
    return null
  }
}

export interface WorkRecord {
  branch: string
  headSha: string | null
  /** Paths the branch changed relative to the main tree's current HEAD. */
  files: string[]
}

/**
 * What a Contact's branch is carrying that nobody else can see yet.
 *
 * Asked of git rather than of the model. The summariser's JSON schema carries a
 * `branch` field and it comes back null every time, because nothing ever tells
 * the model what the branch is — and a model-reported branch would be
 * unverifiable even when it arrived. Main knows the branch from the row, and the
 * head and the file list are two cheap deterministic commands.
 *
 * Null when there is nothing to report. Filesystem state is free between
 * Contacts that share the main tree: every session reads the same checkout, so
 * a change is visible to all of them for nothing, and there is no branch worth
 * naming. A worktree is what degrades that — a writer's work sits on a branch
 * checked out nowhere anybody else can see, so only what it has committed and
 * had merged is free, and the rest has to be said out loud.
 */
/**
 * Makes the Contact's registered branch agree with the worktree's actual HEAD.
 *
 * Nothing stops a session from creating and checking out its own branch inside
 * its worktree, and a session told to "fix it on a branch" has been seen doing
 * exactly that in a live run — leaving the branch the app registered and the
 * branch the work actually landed on divergent. Every reader of
 * `contacts.branch` then drifts from reality at once: the Branches panel lists
 * a branch whose checkout has "moved away", summaries stamp the stale name, the
 * PR title names a branch the PR does not ship, and the Merge button offers
 * commits behind the ones actually pushed. Same principle as recordOfWork's
 * header: git's answer wins over the row.
 *
 * Called at turn end, before the summariser reads the row. Never throws — a
 * bookkeeping reconciliation must not fail a turn that already finished — and
 * returns the Contact as it now stands so callers can keep working with the
 * truth.
 */
export async function reconcileWorktreeBranch(
  contact: Contact,
  actor?: AuditActor
): Promise<Contact> {
  if (isolationOf(contact.isolation) !== 'worktree') return contact
  if (!contact.worktreePath || !existsSync(join(contact.worktreePath, '.git'))) return contact

  try {
    const actual = await currentBranch(contact.worktreePath)
    // Detached HEAD (null) is not a branch to adopt; leave the row alone.
    if (!actual || actual === contact.branch) return contact

    initDb().update(contacts).set({ branch: actual }).where(eq(contacts.id, contact.id)).run()

    // Wrapped separately: the reconciliation above already succeeded, and an
    // audit-recording failure must not make this function claim it didn't —
    // same rule checkBudgetsAfterUsage follows in usage-events.ts.
    try {
      // Only on the branch that actually changes the row — called at every
      // turn's end, so an unguarded write here would dominate the table.
      recordAuditEvent({
        action: 'worktree_reconciled',
        actor,
        contactId: contact.id,
        repoPath: contact.repoPath,
        personaTemplateId: contact.personaTemplateId,
        summary: `Reconciled ${contact.displayName}'s branch from ${contact.branch ?? 'none'} to ${actual}`,
        metadata: { before: contact.branch, after: actual }
      })
    } catch (error) {
      console.warn('[worktrees] could not record audit event for', contact.id, error)
    }

    return { ...contact, branch: actual }
  } catch (error) {
    console.warn('[worktrees] could not reconcile branch for', contact.id, error)
    return contact
  }
}

export async function recordOfWork(contact: Contact): Promise<WorkRecord | null> {
  const { repoPath, worktreePath, branch } = contact
  if (isolationOf(contact.isolation) !== 'worktree') return null
  if (!worktreePath || !branch) return null
  // Never materialised — the Contact exists but has not run, so there is no
  // branch in the repo to describe.
  if (!existsSync(join(worktreePath, '.git'))) return null

  const [head, files] = await Promise.all([
    headSha(worktreePath),
    // Against the main tree's HEAD, which is what "invisible to everyone else"
    // is measured from — that is the tree a colleague reads.
    changedFiles(repoPath, 'HEAD', branch)
  ])

  return { branch, headSha: head, files }
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
