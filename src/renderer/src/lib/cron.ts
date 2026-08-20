/**
 * Turning a cron expression into something a picker can edit, and back.
 *
 * `RoutineEditor` is a schedule picker plus a prompt field, not a text box for
 * a cron expression. A five-character expression in a plain text input leaves
 * anyone who does not already know cron unable to set up a routine at all, and
 * anyone who does with no confirmation they typed what they meant.
 *
 * **node-cron stays in main and this file never imports it.** `cron.ts` in the
 * main process records that reasoning at length: `src/shared/` has exactly one
 * runtime dependency across all of its files, and shipping a scheduler runtime
 * into the renderer bundle to run `validate()` would also leave
 * `import { schedule } from 'node-cron'` one word away from renderer code. So
 * this builds and reads expression *strings*, and `routines.validateSchedule`
 * remains the authority — main validates again on write. The picker is UX; it
 * is not allowed to be the guarantee.
 *
 * The other half of the contract is `parseCron` returning **null**. This
 * understands a deliberately small subset — the schedules people actually set —
 * and anything outside it is not approximated or silently rewritten. Null means
 * "show the raw expression and let them edit it", which is how an expression
 * the picker cannot express survives being opened in the picker.
 */

export type Frequency = 'hourly' | 'daily' | 'weekly' | 'monthly'

export interface Schedule {
  frequency: Frequency
  /** 0-59. Every frequency uses it. */
  minute: number
  /** 0-23. Unused by `hourly`. */
  hour: number
  /**
   * 0-6, Sunday first — the order `node-cron` and every crontab use. Only
   * `weekly`, and never empty: a weekly schedule with no day selected is a
   * routine that never fires, which is a worse answer than refusing the edit.
   */
  weekdays: number[]
  /** 1-31. Only `monthly`. A day past the month's end simply does not fire. */
  dayOfMonth: number
}

export const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

/** The schedule a brand-new routine starts on: every day at 09:00, paused. */
export const DEFAULT_SCHEDULE: Schedule = {
  frequency: 'daily',
  minute: 0,
  hour: 9,
  weekdays: [1, 2, 3, 4, 5],
  dayOfMonth: 1
}

export function buildCron(schedule: Schedule): string {
  const { frequency, minute, hour, weekdays, dayOfMonth } = schedule
  switch (frequency) {
    case 'hourly':
      return `${minute} * * * *`
    case 'daily':
      return `${minute} ${hour} * * *`
    case 'weekly':
      // Sorted and de-duplicated so the same set of days always produces the
      // same string — otherwise clicking Mon then Fri and Fri then Mon would
      // write two different expressions that mean the same thing, and the
      // editor's dirty check would fire on a no-op.
      return `${minute} ${hour} * * ${[...new Set(weekdays)].sort((a, b) => a - b).join(',')}`
    case 'monthly':
      return `${minute} ${hour} ${dayOfMonth} * *`
  }
}

const NUMBER = /^\d+$/

function inRange(value: string, min: number, max: number): number | null {
  if (!NUMBER.test(value)) return null
  const parsed = Number(value)
  return parsed >= min && parsed <= max ? parsed : null
}

/**
 * Reads an expression back into the picker, or returns null if it says
 * something the picker cannot.
 *
 * Only 5-field expressions. Main also accepts the 6-field seconds form — the
 * E2E harness depends on it to observe a fire in seconds rather than a minute —
 * but a routine that fires every few seconds is a test fixture, not a schedule
 * anybody sets on purpose, and giving the picker a seconds row would advertise
 * it as a normal thing to do.
 */
export function parseCron(expression: string): Schedule | null {
  const fields = expression.trim().split(/\s+/)
  if (fields.length !== 5) return null

  const [minuteField, hourField, domField, monthField, dowField] = fields
  // Anything scoped to particular months is outside the subset. Silently
  // dropping the month would show a picker that lies about when it fires.
  if (monthField !== '*') return null

  const minute = inRange(minuteField, 0, 59)
  if (minute === null) return null

  // Hourly: every hour, at a fixed minute.
  if (hourField === '*' && domField === '*' && dowField === '*') {
    return { ...DEFAULT_SCHEDULE, frequency: 'hourly', minute }
  }

  const hour = inRange(hourField, 0, 23)
  if (hour === null) return null

  if (domField === '*' && dowField === '*') {
    return { ...DEFAULT_SCHEDULE, frequency: 'daily', minute, hour }
  }

  // Weekly: specific days of the week, every month.
  if (domField === '*' && dowField !== '*') {
    const weekdays = dowField.split(',').map((day) => inRange(day, 0, 6))
    if (weekdays.length === 0 || weekdays.some((day) => day === null)) return null
    return {
      ...DEFAULT_SCHEDULE,
      frequency: 'weekly',
      minute,
      hour,
      weekdays: [...new Set(weekdays as number[])].sort((a, b) => a - b)
    }
  }

  // Monthly: one day of the month.
  if (dowField === '*' && domField !== '*') {
    const dayOfMonth = inRange(domField, 1, 31)
    if (dayOfMonth === null) return null
    return { ...DEFAULT_SCHEDULE, frequency: 'monthly', minute, hour, dayOfMonth }
  }

  // Both a day-of-month and a day-of-week set. cron ORs these, which is a real
  // behaviour and a genuinely surprising one; the picker does not offer it.
  return null
}

function clock(hour: number, minute: number): string {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

/**
 * The schedule in a sentence, for the line under the picker.
 *
 * Not a substitute for the next-fire times beside it. This says what was asked
 * for; those come from node-cron and say what will actually happen, which is
 * the one that settles an argument about whether a schedule is right.
 */
export function describeSchedule(schedule: Schedule): string {
  const { frequency, minute, hour, weekdays, dayOfMonth } = schedule
  const at = clock(hour, minute)

  if (frequency === 'hourly') {
    return minute === 0 ? 'Every hour, on the hour.' : `Every hour, at ${minute} past.`
  }
  if (frequency === 'daily') return `Every day at ${at}.`
  if (frequency === 'monthly') {
    return `On day ${dayOfMonth} of every month at ${at}.${
      dayOfMonth > 28 ? ' Months that end sooner are skipped.' : ''
    }`
  }

  const days = [...new Set(weekdays)].sort((a, b) => a - b)
  if (days.length === 7) return `Every day at ${at}.`
  if (days.length === 5 && [1, 2, 3, 4, 5].every((day) => days.includes(day))) {
    return `Every weekday at ${at}.`
  }
  const named = days.map((day) => WEEKDAY_LABELS[day])
  const list =
    named.length === 1 ? named[0] : `${named.slice(0, -1).join(', ')} and ${named.at(-1)}`
  return `Every ${list} at ${at}.`
}
