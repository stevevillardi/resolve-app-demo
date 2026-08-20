import { asc, eq } from 'drizzle-orm'
import { initDb } from '../db'
import { toContact } from '../db/mappers'
import { contacts, personaTemplates } from '../db/schema'
import { existsSync } from 'fs'
import { join } from 'path'
import {
  changedFiles,
  commitAll,
  deleteBranch,
  dirtyFiles,
  headSha,
  isAncestor,
  isDirty,
  listBranches,
  mergeBranch,
  mergePreview,
  worktreeList
} from './git'
import { resolveBranchRequests } from './group-messages'
import { listGroups } from './groups'
import { holdersOf } from './run-lock'
import { PERSONA_BRANCH_PREFIX } from './worktrees'
import type { MergePreview } from './git'
import type { GithubScope } from '../../shared/domain'

/**
 * The standing view of work that exists nowhere the user can see it.
 *
 * The third layer of worktree isolation, and the only one with a human in it.
 * Layer 1, awareness — a session starts knowing which sibling branches exist
 * and what they touched — and layer 2, reading — worktrees share one object
 * store, so any of those branches can be diffed and shown without merging
 * anything — are both automatic. Moving work between checkouts is a decision,
 * so it is not. A persona can ask (`branch_request`); nothing merges without a
 * click.
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
  /** Whether the main tree's HEAD already contains this branch. */
  merged: boolean
  /**
   * Uncommitted paths sitting in the branch's worktree — the work `files`
   * cannot see because nothing committed it yet, and what the commit affordance
   * offers to land. Empty when there is no live worktree to read.
   */
  dirtyFiles: string[]
  /**
   * The GitHub authority of the persona behind the branch, so the panel knows
   * whether to offer a pull request. Null for an orphan branch — there is no
   * persona left to authorise one, and merge and discard are all that remain.
   */
  githubScope: GithubScope | null
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
      const hasWorktree = live.has(ref.branch)
      return {
        repoPath,
        branch: ref.branch,
        headSha: ref.headSha,
        committedAt: ref.committedAt,
        contactId: owner?.id ?? null,
        contactName: owner?.displayName ?? null,
        files: await changedFiles(repoPath, 'HEAD', ref.branch),
        hasWorktree,
        merged: await isAncestor(repoPath, ref.branch, 'HEAD'),
        dirtyFiles:
          hasWorktree && owner?.worktreePath
            ? await dirtyFiles(owner.worktreePath).catch(() => [])
            : [],
        githubScope: owner ? (scopeOf(owner.personaTemplateId) ?? null) : null
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
  repoPath: string,
  targetPath: string,
  branch: string
): Promise<{ merged: boolean }> {
  if (await isDirty(targetPath)) {
    throw new Error(
      'That working copy has uncommitted changes. Commit or discard them before merging.'
    )
  }

  await mergeBranch(targetPath, branch)
  // The click that answers the ask: any open branch_request about this branch
  // stops reading as a standing one.
  resolveBranchRequests(repoPath, branch)
  return { merged: true }
}

/**
 * Lands a branch's uncommitted work as a commit, on a click.
 *
 * The one caller of commitAll, and deliberately the only path by which this app
 * authors a commit: the app never commits *unattended*, so no turn and no
 * routine reaches this. The persona is the `--author`, so `git log` attributes
 * the work truthfully; the committer stays whoever git's own config says, which
 * is the user whose click this was.
 */
export async function commitBranchWork(
  repoPath: string,
  branch: string,
  message: string
): Promise<{ committedSha: string; files: string[] }> {
  const owner = allContacts().find(
    (contact) => contact.repoPath === repoPath && contact.branch === branch
  )
  if (!owner?.worktreePath || !existsSync(join(owner.worktreePath, '.git'))) {
    throw new Error(
      'This branch has no live checkout to commit in. Only a branch whose Contact still exists can be committed here.'
    )
  }

  // A run writing into this tree right now would race the `add -A`, and half a
  // turn's work is the worst possible thing to commit.
  const [holder] = holdersOf(owner.worktreePath)
  if (holder) {
    throw new Error(
      `${holder.contactName} is working here. Wait for it to finish, or stop it first.`
    )
  }

  const files = await dirtyFiles(owner.worktreePath)
  if (files.length === 0) throw new Error('Nothing to commit — this checkout is clean.')

  const persona = personaOf(owner.personaTemplateId)
  const author = persona?.name ?? owner.displayName
  const committedSha = await commitAll(owner.worktreePath, message, {
    name: author,
    email: `${emailSlug(author)}@personas.switchboard.local`
  })

  return { committedSha, files }
}

/** Lowercase alphanumerics and dashes — enough for a well-formed address. */
function emailSlug(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'persona'
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
  // Discarding answers the ask too — "no" is an answer, and the group thread
  // should stop showing the request as standing either way.
  resolveBranchRequests(repoPath, branch)
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

/** One row rather than a join, since the panel lists a handful of branches. */
function personaOf(personaTemplateId: string): { name: string } | undefined {
  return initDb()
    .select({ name: personaTemplates.name })
    .from(personaTemplates)
    .where(eq(personaTemplates.id, personaTemplateId))
    .get()
}

/** One row rather than a join, since the panel lists a handful of branches. */
function scopeOf(personaTemplateId: string): GithubScope | undefined {
  return initDb()
    .select({ githubScope: personaTemplates.githubScope })
    .from(personaTemplates)
    .where(eq(personaTemplates.id, personaTemplateId))
    .get()?.githubScope
}
