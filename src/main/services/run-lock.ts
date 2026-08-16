import type { Contact, PersonaTemplate } from '../../shared/domain'

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
 * than the repo. Those are the same string today. They stop being the same once
 * a Contact can run in its own `git worktree`, which is why the indirection
 * exists now rather than later — see workingPathFor().
 *
 * In-memory and single-process, as §15D says: sufficient for a single-user
 * local app. Module-level mutable state matches the existing style in
 * github-auth.ts and codex-auth.ts.
 */

export type LockMode = 'shared' | 'exclusive'

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
 * Where a Contact's session actually runs, which is what gets locked.
 *
 * Returns `repoPath` today, so the lock behaves exactly as if it were keyed on
 * the repo. The worktree phase gives a Contact its own checkout and this starts
 * returning that instead — at which point two writing personas on one repo stop
 * contending, because they are no longer working in the same directory. Every
 * caller goes through here so that change lands in one place.
 */
export function workingPathFor(contact: Contact): string {
  return contact.repoPath
}

/**
 * `read_only` personas share; anything that can write is exclusive.
 *
 * Worth knowing how strong the read-only half is, because it differs by
 * backend and this function cannot tell you: Codex's `--sandbox read-only` is
 * enforced by the OS, and Claude's is too wherever the SDK has a sandbox
 * implementation, with our allowlist behind it. `AgentCapabilities.sandboxEnforcement`
 * reports which of the two a given turn got.
 */
export function lockModeFor(persona: PersonaTemplate): LockMode {
  return persona.sandbox === 'read_only' ? 'shared' : 'exclusive'
}

/**
 * The holder that would refuse `mode` on `workingPath`, or null if nothing
 * would.
 *
 * **Only writer-vs-writer serializes** — `00-progress.md` and
 * `07-group-coordination.md` both say so in those words. A shared run is never
 * refused, and an exclusive run is refused only by another exclusive holder. A
 * `read_only` persona cannot mutate the tree, so it is neither a hazard to
 * others nor entitled to protection from them.
 *
 * The symmetry is the point. A reader may start while a writer holds, and a
 * writer may start while a reader holds; either way the reader can observe a
 * tree mid-write. That is a stale read rather than corruption, and it is the
 * price of the concurrency this exists to allow — a long `read_only` review
 * blocking every writer on the repo would be exactly the serialization the
 * write lock was narrowed to avoid.
 *
 * Shared holders are still *recorded*, because listActiveRuns() and the fleet
 * indicator have to be able to name everyone running. They just never refuse
 * anyone.
 */
export function blockingHolder(workingPath: string, mode: LockMode): RunHolder | null {
  if (mode === 'shared') return null

  const current = holders.get(workingPath) ?? []
  return current.find((holder) => holder.mode === 'exclusive') ?? null
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
