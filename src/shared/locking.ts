import { isolationOf } from './domain'
import type { Contact, Isolation, PersonaTemplate } from './domain'

/**
 * Who the write lock refuses, in the one place both processes can read.
 *
 * The rule itself and its reasoning live in `src/main/services/run-lock.ts`,
 * which owns the actual lock; what is here is only the part the renderer also
 * has to know, because the composer greys itself out when a send would be
 * refused and has to predict that answer before making the call.
 *
 * It is here rather than duplicated there because the renderer may not import
 * `src/main` (eslint `no-restricted-imports`), and the duplicate was wrong.
 * `ThreadView` compared a run's working path against the contact's *repo* path
 * — so an isolated Contact, whose lock key is its worktree, was blocked by runs
 * it can never collide with and unblocked by the ones it can — and it consulted
 * neither run's lock mode, so a `read_only` Contact refused by nobody had its
 * composer disabled whenever anything else touched the repo. That is the
 * reviewer-plus-writer pair blueprint §16 Journey 2 is built on, and the lock
 * was narrowed twice specifically to keep it running.
 *
 * A rule stated twice is a rule that will diverge; the point of this file is
 * that there is nothing left to keep in step.
 */

export type LockMode = 'shared' | 'exclusive'

/**
 * Where a Contact's session actually runs, which is what gets locked.
 *
 * A `worktree` Contact has its own checkout, so this returns a path nobody else
 * uses — which is the whole mechanism by which two writing personas on one repo
 * stop contending. They are not sharing a lock more politely; they are no longer
 * working in the same directory.
 *
 * `worktreePath` is set when the Contact is created, before the directory
 * exists, precisely so this stays a pure function of the row. See the
 * worktree_path comment in src/main/db/schema.ts.
 */
export function workingPathFor(contact: Contact): string {
  return contact.worktreePath ?? contact.repoPath
}

/**
 * `read_only` personas share; anything that can write is exclusive.
 *
 * Isolation decides *where* a session runs, not whether it locks — the two are
 * separate axes and conflating them is easy to do. A `workspace_write` Contact
 * left in the main tree still has to take the lock, or Phase 12 would have
 * quietly unlocked every writer that opted out of worktrees. The one exception
 * is `exclusive`, which exists to demand the main tree to itself, and so locks
 * even for a reader.
 *
 * Worth knowing how strong the read-only half is, because it differs by
 * backend and this function cannot tell you: Codex's `--sandbox read-only` is
 * enforced by the OS, and Claude's is too wherever the SDK has a sandbox
 * implementation, with our allowlist behind it. `AgentCapabilities.sandboxEnforcement`
 * reports which of the two a given turn got.
 */
export function lockModeFor(persona: PersonaTemplate, isolation: Isolation | null): LockMode {
  if (isolationOf(isolation) === 'exclusive') return 'exclusive'
  return persona.sandbox === 'read_only' ? 'shared' : 'exclusive'
}

/**
 * The run that would refuse `mode` on `workingPath`, or null if none would.
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
 * Generic over the run shape so main can pass its own `RunHolder` and the
 * renderer its `ActiveRun` off the wire. Both carry the only two fields the
 * decision reads, which is why one function can serve both.
 */
export function blockingRun<T extends { workingPath: string; mode: LockMode }>(
  runs: readonly T[],
  workingPath: string,
  mode: LockMode
): T | null {
  if (mode === 'shared') return null

  return runs.find((run) => run.workingPath === workingPath && run.mode === 'exclusive') ?? null
}

/**
 * What a refusal says, once.
 *
 * "Here" rather than "in this repo": since Phase 12 a refusal means the two
 * share a working *directory*, which is a narrower thing than sharing a repo —
 * two Contacts in their own worktrees never collide at all, and telling one of
 * them its repo is busy would describe a rule the app no longer has.
 *
 * Main threw one wording and the composer rendered another, flagged but not
 * fixed when Phase 21 found them (`00-progress.md`, "Drafts clear on
 * acceptance"). They were two statements of one rule, so now there is one.
 */
export function lockRefusal(holderName: string | null): string {
  return holderName
    ? `${holderName} is already working here. Wait for it to finish, or stop it from that conversation.`
    : 'This working copy is busy.'
}
