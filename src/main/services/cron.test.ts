import { describe, expect, it } from 'vitest'
import { cronErrorMessage, nextRunsFor, validateCron } from './cron'

/**
 * Written from the claim rather than from node-cron's behaviour: what this
 * service promises is that a schedule the editor accepts is one the scheduler
 * can actually arm, and that a rejection names the field at fault.
 */
describe('validateCron', () => {
  it.each([
    ['0 9 * * *', 'every day at 09:00'],
    ['0 */6 * * *', 'every six hours'],
    ['*/15 * * * *', 'every fifteen minutes'],
    ['0 9 * * 1', 'Mondays'],
    ['*/2 * * * * *', 'six-field, seconds precision']
  ])('accepts %s (%s)', (expression) => {
    expect(validateCron(expression).valid).toBe(true)
  })

  it.each([
    ['not a cron', 'prose'],
    ['99 * * * *', 'minute out of range'],
    ['* * * *', 'too few fields'],
    ['', 'empty'],
    ['   ', 'whitespace only']
  ])('rejects %s (%s)', (expression) => {
    expect(validateCron(expression).valid).toBe(false)
  })

  it('names the field at fault, so the editor can say more than "invalid"', () => {
    const result = validateCron('99 * * * *')

    expect(result.errors[0]?.field).toBe('minute')
    expect(result.errors[0]?.message).toMatch(/99/)
  })

  it('previews the next fires for a valid expression', () => {
    const result = validateCron('*/2 * * * * *')

    expect(result.nextRuns).toHaveLength(3)
    expect(result.nextRuns[0]).toBeGreaterThan(Date.now() - 1000)
    // Strictly increasing: a preview that repeated a time would misdescribe the
    // schedule to the one person deciding whether it is what they meant.
    expect(result.nextRuns[1]).toBeGreaterThan(result.nextRuns[0]!)
    expect(result.nextRuns[2]).toBeGreaterThan(result.nextRuns[1]!)
  })

  it('previews nothing for an invalid expression', () => {
    expect(validateCron('nope').nextRuns).toEqual([])
  })
})

describe('nextRunsFor', () => {
  it('does not leak a task into node-cron for every call', async () => {
    // The probe task enters node-cron's global registry on creation, so a
    // missing destroy() would grow it once per keystroke in the schedule field
    // — and those tasks share the module the scheduler arms its real ones in.
    const { getTasks } = await import('node-cron')
    const before = getTasks().size

    for (let i = 0; i < 20; i += 1) nextRunsFor('0 9 * * *', 3)

    expect(getTasks().size).toBe(before)
  })
})

describe('cronErrorMessage', () => {
  it('is null for a schedule the scheduler could arm', () => {
    expect(cronErrorMessage('0 9 * * *')).toBeNull()
  })

  it('is a sentence for one it could not', () => {
    expect(cronErrorMessage('99 * * * *')).toMatch(/minute/)
  })
})
