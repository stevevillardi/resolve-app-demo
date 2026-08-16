import { randomUUID } from 'crypto'
import { asc, eq } from 'drizzle-orm'
import { initDb } from '../db'
import { toRoutine } from '../db/mappers'
import { routines } from '../db/schema'
import { cronErrorMessage } from './cron'
import type { Routine, RoutineDraft, RoutineUpdate } from '../../shared/domain'

/**
 * Routine CRUD (blueprint §7). A Routine is a cron expression plus a prompt,
 * bound to a Contact — what that Contact should do on wake.
 *
 * The scheduler lives next door in `scheduler.ts` and depends on this module;
 * this one must never depend on it, or the cycle makes both untestable. Whoever
 * calls a mutation here is responsible for re-syncing the schedules, which is
 * composed at the procedure layer.
 *
 * `lastRunAt`/`lastRunSummary` are run history: written by `recordRunOutcome`
 * and by nothing else. Neither write shape carries them, so an editor left open
 * across a fire cannot save its stale copy back over what the fire recorded.
 */

export function listRoutines(): Routine[] {
  return initDb().select().from(routines).orderBy(asc(routines.schedule)).all().map(toRoutine)
}

export function getRoutine(id: string): Routine | null {
  const row = initDb().select().from(routines).where(eq(routines.id, id)).get()
  return row ? toRoutine(row) : null
}

export function listEnabledRoutines(): Routine[] {
  return listRoutines().filter((routine) => routine.enabled)
}

export function createRoutine(draft: RoutineDraft): Routine {
  assertValidSchedule(draft.schedule)

  const routine: Routine = { id: randomUUID(), ...draft, lastRunAt: null, lastRunSummary: null }
  initDb()
    .insert(routines)
    .values({ ...routine, lastRunAt: null })
    .run()
  return routine
}

/**
 * Whole-form save, minus run history.
 *
 * Every column is listed explicitly rather than spread, matching
 * `persona-templates.ts` — an omission here is a silent no-op rather than a
 * type error, which is exactly how `model` went unsaved when that column
 * was added.
 */
export function updateRoutine(update: RoutineUpdate): Routine {
  assertValidSchedule(update.schedule)

  const result = initDb()
    .update(routines)
    .set({
      contactId: update.contactId,
      schedule: update.schedule,
      prompt: update.prompt,
      enabled: update.enabled
    })
    .where(eq(routines.id, update.id))
    .run()

  if (result.changes === 0) throw new Error(`No such routine: ${update.id}`)

  const saved = getRoutine(update.id)
  if (!saved) throw new Error(`No such routine: ${update.id}`)
  return saved
}

export function deleteRoutine(id: string): void {
  initDb().delete(routines).where(eq(routines.id, id)).run()
}

/**
 * Records that a fire happened, whatever came of it.
 *
 * Written on every *attempt*, including one the run lock refused, because
 * otherwise "when did this last try" is unanswerable and the list renders
 * "Never run" for a routine that has been skipping nightly for a week. The
 * summary is what distinguishes the outcomes.
 */
export function recordRunOutcome(id: string, summary: string, at = Date.now()): void {
  initDb()
    .update(routines)
    .set({ lastRunAt: new Date(at), lastRunSummary: summary })
    .where(eq(routines.id, id))
    .run()
}

function assertValidSchedule(schedule: string): void {
  // Main validates even though the editor already did: the renderer's check is
  // UX, this one is the guarantee. A schedule the scheduler cannot arm must not
  // reach the table by any route, including a direct IPC call.
  const error = cronErrorMessage(schedule)
  if (error) throw new Error(`That schedule won't run — ${error}`)
}
