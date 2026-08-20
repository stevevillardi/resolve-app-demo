import { createTask, validateDetailed } from 'node-cron'

/**
 * Cron expression validation and next-fire preview.
 *
 * This and `scheduler.ts`'s engine adapter are the only two files that import
 * `node-cron`, deliberately. The obvious alternative was to put a validator in
 * `src/shared/` so the editor could check a schedule without a round trip — but
 * `src/shared/` currently has exactly one runtime dependency, zod, across all
 * four files, and that is a property worth keeping. Putting node-cron there
 * would ship a scheduler runtime into the renderer bundle for a `validate()`
 * call, and leave `import { schedule } from 'node-cron'` one word away in
 * renderer code.
 *
 * The other alternative, a hand-rolled validator shared by both sides, is a
 * mistake this codebase has already made twice: two implementations that can
 * disagree, where the disagreement looks like a passing test. So validation is
 * a main-process service reached over IPC, and main validates again on write —
 * the renderer's copy is UX, main's is the guarantee.
 *
 * Both 5-field ("0 9 * * *") and 6-field seconds-precision expressions are
 * accepted; node-cron 4.x supports both, and the E2E harness depends on the
 * second form to observe a fire in seconds rather than a minute.
 */

export interface CronFieldProblem {
  field: string
  message: string
}

export interface CronValidation {
  valid: boolean
  errors: CronFieldProblem[]
  /** Up to three upcoming fires as epoch ms, for the editor's preview. Empty when invalid. */
  nextRuns: number[]
}

const PREVIEW_COUNT = 3

export function validateCron(expression: string): CronValidation {
  const trimmed = expression.trim()
  if (!trimmed) {
    return {
      valid: false,
      errors: [{ field: 'schedule', message: 'Enter a schedule.' }],
      nextRuns: []
    }
  }

  const detailed = validateDetailed(trimmed)
  if (!detailed.valid) {
    return {
      valid: false,
      errors: detailed.errors.map((error) => ({ field: error.field, message: error.message })),
      nextRuns: []
    }
  }

  return { valid: true, errors: [], nextRuns: nextRunsFor(trimmed, PREVIEW_COUNT) }
}

/**
 * The next `count` fire times for an expression, as epoch ms.
 *
 * Builds a throwaway task purely to ask it. `createTask` is inert — verified
 * live, it reports `stopped` and never ticks — but it *does* enter node-cron's
 * global `getTasks()` registry, so `destroy()` is not optional tidying: without
 * it, every keystroke in the schedule field would leak a task into the module
 * that the scheduler also uses.
 */
export function nextRunsFor(expression: string, count: number): number[] {
  const task = createTask(expression, () => {})
  try {
    return task.getNextRuns(count).map((date) => date.getTime())
  } catch {
    return []
  } finally {
    void task.destroy()
  }
}

/** The first problem, phrased for a form field. Null when the expression is fine. */
export function cronErrorMessage(expression: string): string | null {
  const result = validateCron(expression)
  return result.valid ? null : (result.errors[0]?.message ?? 'Not a valid cron expression.')
}
