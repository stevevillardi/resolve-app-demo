import { asc } from 'drizzle-orm'
import { existsSync } from 'fs'
import { initDb } from '../db'
import { toContact } from '../db/mappers'
import { contacts } from '../db/schema'
import {
  changedFiles,
  deleteBranch,
  headSha,
  isDirty,
  listBranches,
  mergeBranch,
  mergePreview,
  worktreeList
} from './git'
import { listGroups } from './groups'
import { PERSONA_BRANCH_PREFIX } from './worktrees'
import type { MergePreview } from './git'

/**
 * The standing view of work that exists nowhere the user can see it.
 *
 * Layer 3 of docs/plan/12-worktree-isolation.md. Layers 1 and 2 are automatic —
 * a session is told which branches exist and can read any of them — but moving
 * work between checkouts is a decision, so it is the only part with a human in
 * it. A persona can ask (`branch_request`); nothing merges without a click.
 *
 * Sourced from git rather than from the contacts table, deliberately. A branch
 * outlives the Contact that made it — `worktree remove` keeps it and so does
 * deleting the Contact — so a database-driven list would lose exactly the
 * branches most at risk of being forgotten.
 */

export interface BranchSummary {
  repoPath: string
  branch: string
  headSha: string
  committedAt: number
  /** Null once the Contact that made it has been deleted. */
  contactId: string | null
  contactName: string | null
  /** Paths this branch changed relative to the main tree's HEAD. */
  files: string[]
  /** False when the Contact is gone or the user deleted the directory. */
  hasWorktree: boolean
}

export interface MergeTarget {
  path: string
  label: string
  /** Uncommitted changes present, which is a reason not to merge into it yet. */
  dirty: boolean
}

export async function listPersonaBranches(): Promise<BranchSummary[]> {
  const contacts = allContacts()

  const summaries: BranchSummary[] = []
  // Iterated over Groups rather than Contacts, because a Group is created per
  // repo and never removed with its members. Deriving the repo list from
  // contacts would drop every branch whose owner had been deleted — which is
  // the exact case this function exists to keep visible.
  for (const { repoPath } of listGroups()) {
    summaries.push(
      ...(await branchesIn(
        repoPath,
        contacts.filter((contact) => contact.repoPath === repoPath)
      ))
    )
  }

  // Most recent first: the panel is a worklist, and the branch somebody just
  // asked about is the one they came here for.
  return summaries.sort((a, b) => b.committedAt - a.committedAt)
}

async function branchesIn(
  repoPath: string,
  repoContacts: ReturnType<typeof toContact>[]
): Promise<BranchSummary[]> {
  let refs: Awaited<ReturnType<typeof listBranches>>
  try {
    refs = await listBranches(repoPath, PERSONA_BRANCH_PREFIX)
  } catch {
    // A repo that has been moved, unmounted, or deleted since a Contact was
    // bound to it. One unreachable repo must not empty the whole panel.
    return []
  }

  const live = new Set(
    (await worktreeList(repoPath).catch(() => []))
      .filter((entry) => !entry.prunable)
      .map((e) => e.branch)
  )

  return Promise.all(
    refs.map(async (ref) => {
      const owner = repoContacts.find((contact) => contact.branch === ref.branch)
      return {
        repoPath,
        branch: ref.branch,
        headSha: ref.headSha,
        committedAt: ref.committedAt,
        contactId: owner?.id ?? null,
        contactName: owner?.displayName ?? null,
        files: await changedFiles(repoPath, 'HEAD', ref.branch),
        hasWorktree: live.has(ref.branch)
      }
    })
  )
}

/**
 * Where a branch could be merged to: the user's own checkout, and every other
 * Contact's.
 *
 * Merging is per working path rather than per repo because that is the whole
 * point — taking a colleague's work into the reviewer's tree must not touch the
 * user's. `dirty` is reported rather than used to filter, so the reason a target
 * is unavailable is visible instead of the target simply being missing.
 */
export async function mergeTargetsFor(repoPath: string): Promise<MergeTarget[]> {
  const candidates = [
    { path: repoPath, label: 'Your checkout' },
    ...allContacts()
      .filter((contact) => contact.repoPath === repoPath && contact.worktreePath)
      .map((contact) => ({ path: contact.worktreePath as string, label: contact.displayName }))
  ]

  return Promise.all(
    candidates
      .filter((candidate) => existsSync(candidate.path))
      .map(async (candidate) => ({
        ...candidate,
        dirty: await isDirty(candidate.path).catch(() => true)
      }))
  )
}

/**
 * Whether `branch` merges into `targetPath` cleanly, without touching anything.
 *
 * Answers the question about the two *commits*. A dirty target is reported
 * separately by mergeTargetsFor, because "these commits merge cleanly" and "this
 * merge will succeed right now" are different claims and conflating them would
 * make the button lie in the one case the user most needs it not to.
 */
export async function previewMerge(
  repoPath: string,
  targetPath: string,
  branch: string
): Promise<MergePreview> {
  const target = await headOf(targetPath)
  return mergePreview(repoPath, target, branch)
}

export async function mergeIntoWorkingPath(
  targetPath: string,
  branch: string
): Promise<{ merged: boolean }> {
  if (await isDirty(targetPath)) {
    throw new Error(
      'That working copy has uncommitted changes. Commit or discard them before merging.'
    )
  }

  await mergeBranch(targetPath, branch)
  return { merged: true }
}

/**
 * Throws unless the branch is already merged, which is the safe half of the
 * button. `force` is what the confirm dialog passes once the user has been told
 * the work is unmerged.
 */
export async function discardBranch(
  repoPath: string,
  branch: string,
  force = false
): Promise<{ deleted: boolean }> {
  await deleteBranch(repoPath, branch, force)
  return { deleted: true }
}

async function headOf(workingPath: string): Promise<string> {
  const sha = await headSha(workingPath)
  if (!sha) throw new Error(`Could not read the current commit of ${workingPath}.`)
  return sha
}

function allContacts(): ReturnType<typeof toContact>[] {
  return initDb().select().from(contacts).orderBy(asc(contacts.displayName)).all().map(toContact)
}
