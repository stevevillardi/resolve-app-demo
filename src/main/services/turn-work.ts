import { existsSync } from 'fs'
import { join } from 'path'
import { currentBranch, diffNameOnlyBetween, dirtyFiles, headSha } from './git'
import type { TurnWork } from '../../shared/domain'

/**
 * What one turn did to its working tree, measured by git — never claimed by
 * the model (Phase 19). The same rule recordOfWork() set for summaries, applied
 * per turn: heads are read before the run and after it, and the difference is
 * the turn's committed work.
 *
 * Uncommitted work is attributed more carefully than it looks. `dirty` carries
 * only paths that were clean before the turn and dirty after it — a path
 * already dirty at turn start is *not* attributed, because git cannot say
 * whether this turn touched it. That means a turn editing an already-dirty
 * file goes unrecorded here; stated in turnWorkSchema's comment rather than
 * hidden, and the honest trade against blaming a turn for someone else's
 * half-finished edit.
 *
 * Both halves swallow git failures into "no record": a Contact bound to a
 * plain directory has no heads and no status, and a work record is an
 * annotation, never worth failing a finished turn over.
 */

export interface TurnWorkStart {
  headBefore: string | null
  dirtyBefore: ReadonlySet<string>
}

/**
 * Null for a working path with no `.git` — a plain bound directory has no
 * heads to read, and the sync check means the turn path spawns no git process
 * at all for it. `.git` may be a file (a linked worktree) or a directory;
 * existsSync covers both.
 */
export async function captureWorkStart(workingPath: string): Promise<TurnWorkStart | null> {
  if (!existsSync(join(workingPath, '.git'))) return null
  const [headBefore, dirty] = await Promise.all([
    headSha(workingPath),
    dirtyFiles(workingPath).catch(() => [] as string[])
  ])
  return { headBefore, dirtyBefore: new Set(dirty) }
}

/** Null when the turn changed nothing — the record is absence, not an empty row. */
export async function captureWorkEnd(
  workingPath: string,
  start: TurnWorkStart
): Promise<TurnWork | null> {
  const [headAfter, branch, dirtyAfter] = await Promise.all([
    headSha(workingPath),
    currentBranch(workingPath),
    dirtyFiles(workingPath).catch(() => [] as string[])
  ])

  const committed =
    start.headBefore && headAfter && headAfter !== start.headBefore
      ? await diffNameOnlyBetween(workingPath, start.headBefore, headAfter)
      : []
  const dirty = dirtyAfter.filter((path) => !start.dirtyBefore.has(path))

  if (committed.length === 0 && dirty.length === 0) return null
  return { branch, headBefore: start.headBefore, headAfter, committed, dirty }
}
