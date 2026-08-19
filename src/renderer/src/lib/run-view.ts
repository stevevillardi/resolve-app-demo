import type { ActiveRun } from '../../../shared/ipc-contract'

/**
 * The decisions behind every surface that names a running turn (Phase 25):
 * which run belongs to a routine, what a turn's origin is called on screen,
 * and where clicking a run should land. In lib/ because the renderer test
 * project reaches only `lib/*.test.ts` — the components stay presentational.
 */

/** The active run a routine is responsible for, if it is running right now. */
export function routineRun(runs: readonly ActiveRun[], routineId: string): ActiveRun | undefined {
  return runs.find((run) => run.origin === 'routine' && run.routineId === routineId)
}

/**
 * The user-facing word for a turn's origin. `message` becomes "chat" — the
 * user typed it in a chat; "message" next to a conversation is noise.
 */
export function originLabel(origin: ActiveRun['origin']): 'chat' | 'mention' | 'routine' {
  return origin === 'message' ? 'chat' : origin
}

/**
 * Where clicking a running turn should land. A mention was sent *from* a
 * group thread and its reply renders there too, so that is where the click
 * belongs; a chat or routine turn lives in the contact's own thread.
 */
export function runTarget(run: ActiveRun): { kind: 'contact' | 'group'; id: string } {
  if (run.origin === 'mention' && run.groupId) return { kind: 'group', id: run.groupId }
  return { kind: 'contact', id: run.contactId }
}
