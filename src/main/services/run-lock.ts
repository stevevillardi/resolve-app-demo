import { blockingRun } from '../../shared/locking'
import type { LockMode } from '../../shared/locking'

/**
 * Who may run where, at the same time (blueprint §15D).
 *
 * **This narrows §15D deliberately.** The blueprint specifies `repoPath →
 * boolean busy`, checked before starting *any* run. That is stricter than the
 * hazard it exists for. What actually breaks is two agents mutating one working
 * tree at once — half-applied edits, one agent reading a file another is
 * rewriting, contention on `.git/index.lock`. A `read_only` persona does none of
 * that, so blocking it buys nothing and costs a great deal: it would stop a
 * reviewer from reading a repo while a refactor is in progress, which is
 * exactly the pair blueprint §16 Journey 2 wants running together.
 *
 * So the lock is a *write* lock, and it is keyed on the **working path** rather
 * than the repo. Since Phase 12 those are genuinely different strings: a Contact
 * with its own `git worktree` locks its own checkout, which nobody else works
 * in — see workingPathFor().
 *
 * In-memory and single-process, as §15D says: sufficient for a single-user
 * local app. Module-level mutable state matches the existing style in
 * github-auth.ts and codex-auth.ts.
 *
 * The *decision* — who refuses whom — lives in `src/shared/locking.ts`, because
 * the composer has to predict this answer before sending and the renderer cannot
 * import this file. What stays here is the state: who currently holds what.
 */

export { workingPathFor, lockModeFor, lockRefusal, type LockMode } from '../../shared/locking'

export interface RunHolder {
  runId: string
  contactId: string
  /** Shown to the user when this holder blocks someone. */
  contactName: string
  workingPath: string
  mode: LockMode
  startedAt: number
}

/** Undoes exactly one acquire(). Idempotent — a double release is a no-op. */
export type Release = () => void

/**
 * Path → everyone currently running there.
 *
 * A list rather than a single slot because shared holders are unlimited: two
 * readers on one repo is the common case, and the UI has to be able to name all
 * of them. An entry is removed when it empties, so a quiet path holds no memory.
 */
const holders = new Map<string, RunHolder[]>()

/**
 * The holder that would refuse `mode` on `workingPath`, or null if nothing
 * would — this module's state, decided by the shared rule.
 *
 * Shared holders are still *recorded*, because listActiveRuns() and the fleet
 * indicator have to be able to name everyone running. They just never refuse
 * anyone. See `blockingRun` in src/shared/locking.ts for why.
 */
export function blockingHolder(workingPath: string, mode: LockMode): RunHolder | null {
  return blockingRun(holders.get(workingPath) ?? [], workingPath, mode)
}

/**
 * Takes the lock, or returns null if something else holds it.
 *
 * Null rather than a throw: the caller has a better message to write than this
 * module does, because it knows who was asking.
 */
export function acquire(holder: RunHolder): Release | null {
  if (blockingHolder(holder.workingPath, holder.mode)) return null

  const current = holders.get(holder.workingPath) ?? []
  holders.set(holder.workingPath, [...current, holder])

  let released = false
  return () => {
    // Idempotent: the messaging service releases in a `finally`, and an abort
    // path can plausibly reach that twice. Releasing by runId rather than by
    // position also means a reader finishing out of order can't evict a peer.
    if (released) return
    released = true

    const remaining = (holders.get(holder.workingPath) ?? []).filter(
      (candidate) => candidate.runId !== holder.runId
    )
    if (remaining.length > 0) holders.set(holder.workingPath, remaining)
    else holders.delete(holder.workingPath)
  }
}

/** Everything running at `workingPath`, in acquisition order. */
export function holdersOf(workingPath: string): RunHolder[] {
  return [...(holders.get(workingPath) ?? [])]
}

export function activeRuns(): RunHolder[] {
  return [...holders.values()].flat()
}

/** Test-only. Nothing in the app releases a lock it did not take. */
export function resetRunLocks(): void {
  holders.clear()
}
