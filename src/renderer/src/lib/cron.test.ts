import { describe, expect, it } from 'vitest'
import {
  buildCron,
  DEFAULT_SCHEDULE,
  describeSchedule,
  parseCron,
  shortSchedule,
  type Schedule
} from './cron'

/**
 * Two claims, and the second one is the one that keeps the picker honest.
 *
 * 1. Anything the picker can produce, it can read back. A round trip that loses
 *    information would mean reopening a saved routine showed a different
 *    schedule from the one that fires.
 * 2. Anything it *cannot* express returns null rather than an approximation.
 *    Silently rewriting `0 9 * * 1#2` into something the picker can draw would
 *    change when someone's routine runs, without saying so.
 *
 * node-cron is deliberately not imported here — it lives in main, and this file
 * exists precisely so the renderer never needs it. That means these tests check
 * the *strings*, and `routines.validateSchedule` remains the authority on
 * whether a string is valid at all.
 */

function schedule(overrides: Partial<Schedule> = {}): Schedule {
  return { ...DEFAULT_SCHEDULE, ...overrides }
}

describe('buildCron', () => {
  it('writes each frequency in the field it belongs in', () => {
    expect(buildCron(schedule({ frequency: 'hourly', minute: 30 }))).toBe('30 * * * *')
    expect(buildCron(schedule({ frequency: 'daily', minute: 0, hour: 9 }))).toBe('0 9 * * *')
    expect(
      buildCron(schedule({ frequency: 'weekly', minute: 15, hour: 8, weekdays: [1, 3] }))
    ).toBe('15 8 * * 1,3')
    expect(buildCron(schedule({ frequency: 'monthly', minute: 0, hour: 6, dayOfMonth: 12 }))).toBe(
      '0 6 12 * *'
    )
  })

  it('normalises the weekday set, so the same days always write the same string', () => {
    // Clicking Fri then Mon must not produce a different expression from Mon
    // then Fri — the editor's dirty check compares strings, and it would light
    // up on a change that means nothing.
    expect(buildCron(schedule({ frequency: 'weekly', weekdays: [5, 1, 5] }))).toBe(
      buildCron(schedule({ frequency: 'weekly', weekdays: [1, 5] }))
    )
  })
})

describe('parseCron round-trips everything the picker can build', () => {
  const cases: Schedule[] = [
    schedule({ frequency: 'hourly', minute: 0 }),
    schedule({ frequency: 'hourly', minute: 45 }),
    schedule({ frequency: 'daily', minute: 0, hour: 0 }),
    schedule({ frequency: 'daily', minute: 59, hour: 23 }),
    schedule({ frequency: 'weekly', minute: 30, hour: 9, weekdays: [0] }),
    schedule({ frequency: 'weekly', minute: 30, hour: 9, weekdays: [1, 2, 3, 4, 5] }),
    schedule({ frequency: 'weekly', minute: 0, hour: 17, weekdays: [0, 6] }),
    schedule({ frequency: 'monthly', minute: 0, hour: 9, dayOfMonth: 1 }),
    schedule({ frequency: 'monthly', minute: 0, hour: 9, dayOfMonth: 31 })
  ]

  it.each(cases)('$frequency $minute $hour', (original) => {
    const parsed = parseCron(buildCron(original))
    expect(parsed).not.toBeNull()
    // Compared through buildCron rather than field by field: the fields the
    // frequency does not use are free to differ, and asserting on them would
    // make this test about the defaults instead of about the schedule.
    expect(buildCron(parsed!)).toBe(buildCron(original))
    expect(parsed!.frequency).toBe(original.frequency)
  })

  it('reads the schedule a new routine is created with', () => {
    expect(parseCron('0 9 * * *')).toMatchObject({ frequency: 'daily', hour: 9, minute: 0 })
  })
})

describe('parseCron refuses what it cannot express', () => {
  it.each([
    // Not five fields. Main accepts a 6-field seconds form for the E2E harness;
    // the picker deliberately does not offer per-second scheduling.
    ['*/5 0 9 * * *', 'six fields'],
    ['0 9 * *', 'four fields'],
    ['', 'empty'],
    // Step and range syntax. Expressible in cron, not in this picker — and
    // rewriting `*/15` as "on the hour" would change when it fires.
    ['*/15 * * * *', 'a step'],
    ['0 9-17 * * *', 'an hour range'],
    ['0 9 * * 1-5', 'a weekday range'],
    // Month-scoped.
    ['0 9 1 1 *', 'a specific month'],
    // cron ORs day-of-month with day-of-week, which is real and surprising.
    ['0 9 1 * 1', 'both day fields'],
    // Named days, and out-of-range numbers.
    ['0 9 * * MON', 'a named weekday'],
    ['0 24 * * *', 'hour 24'],
    ['60 9 * * *', 'minute 60'],
    ['0 9 32 * *', 'day 32'],
    ['0 9 0 * *', 'day 0'],
    ['0 9 * * 7', 'weekday 7']
  ])('returns null for %s (%s)', (expression) => {
    expect(parseCron(expression)).toBeNull()
  })

  it('never silently changes what an expression means', () => {
    // The whole point of returning null: an expression it cannot draw is handed
    // back to the raw field untouched rather than approximated into one it can.
    const unsupported = '*/15 9-17 * * 1-5'
    expect(parseCron(unsupported)).toBeNull()
  })
})

describe('describeSchedule', () => {
  it('says the common ones the way a person would', () => {
    expect(describeSchedule(schedule({ frequency: 'hourly', minute: 0 }))).toBe(
      'Every hour, on the hour.'
    )
    expect(describeSchedule(schedule({ frequency: 'hourly', minute: 20 }))).toBe(
      'Every hour, at 20 past.'
    )
    expect(describeSchedule(schedule({ frequency: 'daily', hour: 9, minute: 0 }))).toBe(
      'Every day at 09:00.'
    )
    expect(
      describeSchedule(schedule({ frequency: 'weekly', hour: 8, minute: 30, weekdays: [1, 5] }))
    ).toBe('Every Mon and Fri at 08:30.')
  })

  it('recognises weekdays and a full week rather than listing seven days', () => {
    expect(
      describeSchedule(
        schedule({ frequency: 'weekly', hour: 9, minute: 0, weekdays: [1, 2, 3, 4, 5] })
      )
    ).toBe('Every weekday at 09:00.')
    expect(
      describeSchedule(
        schedule({ frequency: 'weekly', hour: 9, minute: 0, weekdays: [0, 1, 2, 3, 4, 5, 6] })
      )
    ).toBe('Every day at 09:00.')
  })

  it('warns that a late day-of-month skips short months', () => {
    // February has no 30th. cron simply does not fire, which is surprising
    // enough to be worth saying out loud rather than discovering in March.
    expect(describeSchedule(schedule({ frequency: 'monthly', dayOfMonth: 30 }))).toMatch(/skipped/)
    expect(describeSchedule(schedule({ frequency: 'monthly', dayOfMonth: 28 }))).not.toMatch(
      /skipped/
    )
  })

  it('pads the clock, so times line up and never read as 9:0', () => {
    expect(describeSchedule(schedule({ frequency: 'daily', hour: 9, minute: 5 }))).toContain(
      '09:05'
    )
  })
})

describe('shortSchedule', () => {
  it('says every four hours in words, not in cron', () => {
    // The §A3 complaint: the rail rendered the expression verbatim while the
    // editor beside it had been rendering English since Phase 16.
    expect(shortSchedule(buildCron({ ...schedule(), frequency: 'hourly', minute: 0 }))).toBe(
      'Hourly'
    )
  })

  it('names the minute when an hourly run is not on the hour', () => {
    expect(shortSchedule(buildCron({ ...schedule(), frequency: 'hourly', minute: 5 }))).toBe(
      'Hourly :05'
    )
  })

  it('gives a daily run its time', () => {
    expect(
      shortSchedule(buildCron({ ...schedule(), frequency: 'daily', hour: 9, minute: 0 }))
    ).toBe('Daily 09:00')
  })

  it('collapses all seven weekdays to daily', () => {
    const weekly = buildCron({
      ...schedule(),
      frequency: 'weekly',
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      hour: 9,
      minute: 0
    })
    expect(shortSchedule(weekly)).toBe('Daily 09:00')
  })

  it('collapses Monday to Friday to weekdays', () => {
    const weekly = buildCron({
      ...schedule(),
      frequency: 'weekly',
      weekdays: [1, 2, 3, 4, 5],
      hour: 9,
      minute: 0
    })
    expect(shortSchedule(weekly)).toBe('Weekdays 09:00')
  })

  it('lists the days when it is neither', () => {
    const weekly = buildCron({
      ...schedule(),
      frequency: 'weekly',
      weekdays: [1, 3],
      hour: 17,
      minute: 30
    })
    expect(shortSchedule(weekly)).toBe('Mon, Wed 17:30')
  })

  it('gives a monthly run its day', () => {
    const monthly = buildCron({
      ...schedule(),
      frequency: 'monthly',
      dayOfMonth: 5,
      hour: 9,
      minute: 0
    })
    expect(shortSchedule(monthly)).toBe('Day 5, 09:00')
  })

  /**
   * The contract this file's header states: `parseCron` returning null *is*
   * Custom mode. An expression the picker cannot build is one somebody typed
   * on purpose, and inventing prose for it would print a guess as a fact.
   */
  it('hands back an expression it cannot parse, verbatim', () => {
    expect(shortSchedule('15 2,14 * * 1-5')).toBe('15 2,14 * * 1-5')
    expect(shortSchedule('not a cron')).toBe('not a cron')
  })
})
