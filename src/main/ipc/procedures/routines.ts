import { registerProcedure } from '../registerProcedure'
import { validateCron } from '../../services/cron'
import {
  createRoutine,
  deleteRoutine,
  getRoutine,
  listRoutines,
  updateRoutine
} from '../../services/routines'
import { fireRoutine, syncSchedules } from '../../services/scheduler'

/**
 * Routine CRUD, validation, and the manual trigger (blueprint §7).
 *
 * Every mutation re-syncs the schedules. That composition lives here rather
 * than inside `routines.ts` on purpose: the scheduler depends on the CRUD
 * service, so having the CRUD service call back into the scheduler would make
 * a cycle and leave neither testable on its own. The procedure layer is the
 * one place that already knows about both.
 */

registerProcedure('routines.list', () => listRoutines())
registerProcedure('routines.get', ({ id }) => getRoutine(id))

registerProcedure('routines.create', (draft) => {
  const routine = createRoutine(draft)
  syncSchedules()
  return routine
})

registerProcedure('routines.update', (update) => {
  const routine = updateRoutine(update)
  // Covers the enable toggle and a changed expression alike — syncSchedules
  // diffs, so an unrelated edit does not move anything else's next fire time.
  syncSchedules()
  return routine
})

registerProcedure('routines.delete', ({ id }) => {
  deleteRoutine(id)
  syncSchedules()
  return { deleted: true }
})

registerProcedure('routines.validateSchedule', ({ schedule }) => {
  const result = validateCron(schedule)
  return {
    valid: result.valid,
    error: result.valid ? null : (result.errors[0]?.message ?? 'Not a valid cron expression.'),
    nextRuns: result.nextRuns
  }
})

/**
 * Not awaited: `fireRoutine` is synchronous up to the point the turn is
 * running, and its `completed` promise resolves minutes later. The scheduler
 * writes the run history itself when it settles, so nothing here has to wait.
 */
registerProcedure('routines.runNow', ({ id }) => {
  const fire = fireRoutine(id)
  if (fire.runId) return { runId: fire.runId, skipped: null }

  // Already settled whenever runId is null — a refusal or a missing routine is
  // decided before any turn starts, so this resolves immediately.
  return fire.completed.then((result) => ({ runId: null, skipped: result.summary }))
})
