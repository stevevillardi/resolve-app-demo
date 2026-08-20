import { schedule } from 'node-cron'
import type { CronEngine, CronHandle } from './scheduler'

/**
 * The real cron engine, and the only place `node-cron` drives anything.
 *
 * Kept apart from `scheduler.ts` for the same reason the adapters are kept
 * apart from the services that call them: the policy is worth testing and the
 * vendor binding is not, so the binding is the thin half.
 *
 * Two settings are deliberate rather than defaults:
 *
 * **`missedExecutionTolerance`.** node-cron arms one timer to the next match and,
 * on a late wake, runs the slot only if it is less than this late — otherwise it
 * emits `execution:missed` and skips to the next future match. The default is
 * **1000 ms**, which is aggressive for a process that runs synchronous
 * better-sqlite3 queries and spawns SDK subprocesses on the same event loop: a
 * routine two seconds late is still doing its job. A minute is generous enough
 * to survive that without being long enough to look like a bug.
 *
 * **No timezone.** Schedules match the system's local wall clock, because
 * "every day at 09:00" means the user's 09:00. Note node-cron's own caveat that
 * a sub-hourly schedule can pause for the length of a DST shift.
 *
 * What this cannot do, recorded as a standing limitation: a fire missed
 * because the machine slept or the app was quit is **not** caught up.
 * node-cron persists nothing and offers no exactly-once guarantee across
 * restarts. The scheduler records the miss rather than pretending it ran.
 */
export function nodeCronEngine(): CronEngine {
  return {
    schedule(
      expression: string,
      onTick: () => void,
      name: string,
      onMissed?: (date: Date) => void
    ): CronHandle {
      const task = schedule(expression, onTick, {
        name,
        missedExecutionTolerance: MISSED_TOLERANCE_MS
      })

      task.on('execution:missed', (context) => {
        console.warn(
          `[scheduler] routine ${name} missed its ${context.date.toISOString()} fire — ` +
            'the app was not running, or the event loop was blocked past the tolerance'
        )
        onMissed?.(context.date)
      })

      return {
        destroy: () => void task.destroy(),
        getNextRun: () => task.getNextRun()
      }
    }
  }
}

const MISSED_TOLERANCE_MS = 60_000
