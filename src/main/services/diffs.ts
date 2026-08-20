import { existsSync, readFileSync, statSync } from 'fs'
import { join } from 'path'
import { eq } from 'drizzle-orm'
import { initDb } from '../db'
import { toMessage } from '../db/mappers'
import { messages } from '../db/schema'
import { getContact } from './contacts'
import {
  binaryPaths,
  diffNameStatus,
  fileAtRev,
  listBranches,
  mergeBase,
  type ChangedEntry
} from './git'
import { workingPathFor } from './run-lock'
import { PERSONA_BRANCH_PREFIX } from './worktrees'
import { notFound } from './not-found'

/**
 * The content behind the diff viewer.
 *
 * Serves whole file pairs with stated budgets rather than paging: a turn or a
 * branch usually touches a handful of readable files, and the rare monster is
 * *withheld with a flag* rather than clipped — a half-served file reviews as a
 * whole one, which is the dishonest direction. Budgets:
 *
 *   - per file: FILE_TEXT_MAX per side, else `truncated`
 *   - per response: RESPONSE_TEXT_BUDGET across all sides, then `truncated`
 *   - per response: DIFF_FILES_MAX entries, then the list itself is cut and
 *     `filesOmitted` says by how many
 *
 * Two callers, one assembly. A branch diff is merge-base → branch tip (the
 * three-dot question, same as changedFiles). A work diff is the turn's own
 * heads, plus its newly-dirty files read from the working tree *now* — those
 * are marked `live`, because the tree has had time to move since the turn.
 */

export const FILE_TEXT_MAX = 300_000
export const RESPONSE_TEXT_BUDGET = 3_000_000
export const DIFF_FILES_MAX = 200

export interface FileDiff {
  path: string
  oldPath?: string
  status: 'added' | 'modified' | 'deleted' | 'renamed'
  binary: boolean
  truncated: boolean
  /** newText came off the working tree just now, not from the turn's moment. */
  live: boolean
  oldText: string | null
  newText: string | null
}

export interface DiffResult {
  files: FileDiff[]
  filesOmitted: number
}

export async function branchDiff(
  repoPath: string,
  branch: string
): Promise<DiffResult & { baseSha: string | null }> {
  // The branch name is renderer-supplied; resolving it against our own listing
  // is both the validation (no arbitrary revs reach git's argv) and the clean
  // failure for a selection that was merged away under the panel.
  const known = await listBranches(repoPath, PERSONA_BRANCH_PREFIX)
  if (!known.some((ref) => ref.branch === branch)) {
    throw new Error(`${branch} no longer exists in this repository.`)
  }

  const base = await mergeBase(repoPath, 'HEAD', branch)
  if (!base) return { baseSha: null, files: [], filesOmitted: 0 }

  const [entries, binaries] = await Promise.all([
    diffNameStatus(repoPath, base, branch),
    binaryPaths(repoPath, base, branch)
  ])

  const files = await assemblePairs(repoPath, base, branch, entries, binaries)
  return { baseSha: base, ...files }
}

export async function workDiff(contactId: string, messageId: string): Promise<DiffResult> {
  const contact = getContact(contactId)
  if (!contact) throw notFound('contact', contactId)

  const row = initDb().select().from(messages).where(eq(messages.id, messageId)).get()
  if (!row || row.contactId !== contactId) throw notFound('message', messageId)

  const work = toMessage(row).work
  if (!work) return { files: [], filesOmitted: 0 }

  const workingPath = workingPathFor(contact)
  const results: FileDiff[] = []
  const budget = new Budget()

  // The committed half: this turn's own heads, straight from the record.
  if (work.headBefore && work.headAfter && work.headBefore !== work.headAfter) {
    const [entries, binaries] = await Promise.all([
      diffNameStatus(workingPath, work.headBefore, work.headAfter),
      binaryPaths(workingPath, work.headBefore, work.headAfter)
    ])
    const committed = await assemblePairs(
      workingPath,
      work.headBefore,
      work.headAfter,
      entries,
      binaries,
      budget
    )
    results.push(...committed.files)
    if (committed.filesOmitted > 0) return { files: results, filesOmitted: committed.filesOmitted }
  }

  // The uncommitted half, read from the tree as it is now — honestly marked
  // `live`, since the file may have moved on since the turn ended.
  const baseRev = shaOrNull(work.headAfter) ?? shaOrNull(work.headBefore)
  for (const path of work.dirty.slice(0, DIFF_FILES_MAX)) {
    results.push(await liveFilePair(workingPath, baseRev, path, budget))
  }
  const omitted = Math.max(0, work.dirty.length - DIFF_FILES_MAX)

  return { files: results, filesOmitted: omitted }
}

/** Only a sha this app wrote reaches git's argv; anything else degrades to null. */
function shaOrNull(value: string | null): string | null {
  return value && /^[0-9a-f]{40}$/.test(value) ? value : null
}

/** Tracks the response-wide text budget across both halves of a work diff. */
class Budget {
  private spent = 0

  /** True if `size` more characters still fit; charges them if so. */
  charge(size: number): boolean {
    if (this.spent + size > RESPONSE_TEXT_BUDGET) return false
    this.spent += size
    return true
  }
}

async function assemblePairs(
  cwd: string,
  oldRev: string,
  newRev: string,
  entries: ChangedEntry[],
  binaries: Set<string>,
  budget = new Budget()
): Promise<DiffResult> {
  const kept = entries.slice(0, DIFF_FILES_MAX)
  const files: FileDiff[] = []

  for (const entry of kept) {
    const binary = binaries.has(entry.path) || (entry.oldPath ? binaries.has(entry.oldPath) : false)
    const base: FileDiff = {
      path: entry.path,
      ...(entry.oldPath ? { oldPath: entry.oldPath } : {}),
      status: entry.status,
      binary,
      truncated: false,
      live: false,
      oldText: null,
      newText: null
    }
    if (binary) {
      files.push(base)
      continue
    }

    const [oldSide, newSide] = await Promise.all([
      entry.status === 'added'
        ? Promise.resolve({ text: null, truncated: false })
        : fileAtRev(cwd, oldRev, entry.oldPath ?? entry.path, FILE_TEXT_MAX),
      entry.status === 'deleted'
        ? Promise.resolve({ text: null, truncated: false })
        : fileAtRev(cwd, newRev, entry.path, FILE_TEXT_MAX)
    ])

    const size = (oldSide.text?.length ?? 0) + (newSide.text?.length ?? 0)
    if (oldSide.truncated || newSide.truncated || !budget.charge(size)) {
      files.push({ ...base, truncated: true })
    } else {
      files.push({ ...base, oldText: oldSide.text, newText: newSide.text })
    }
  }

  return { files, filesOmitted: entries.length - kept.length }
}

/** One newly-dirty file: committed side from git, current side off the disk. */
async function liveFilePair(
  workingPath: string,
  baseRev: string | null,
  path: string,
  budget: Budget
): Promise<FileDiff> {
  const oldSide = baseRev
    ? await fileAtRev(workingPath, baseRev, path, FILE_TEXT_MAX)
    : { text: null, truncated: false }

  const absolute = join(workingPath, path)
  const onDisk = existsSync(absolute)
  const status: FileDiff['status'] =
    oldSide.text === null && !oldSide.truncated ? 'added' : onDisk ? 'modified' : 'deleted'

  const base: FileDiff = {
    path,
    status,
    binary: false,
    truncated: false,
    live: true,
    oldText: null,
    newText: null
  }

  let newText: string | null = null
  let tooBig = oldSide.truncated
  if (onDisk) {
    try {
      if (statSync(absolute).size > FILE_TEXT_MAX) {
        tooBig = true
      } else {
        const buffer = readFileSync(absolute)
        // The same test git applies: a NUL early in the file means binary.
        if (buffer.subarray(0, 8000).includes(0)) return { ...base, binary: true }
        newText = buffer.toString('utf8')
      }
    } catch {
      newText = null
    }
  }

  const size = (oldSide.text?.length ?? 0) + (newText?.length ?? 0)
  if (tooBig || !budget.charge(size)) return { ...base, truncated: true }
  return { ...base, oldText: oldSide.text, newText }
}
