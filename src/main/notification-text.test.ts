import { describe, expect, it } from 'vitest'
import {
  budgetNotification,
  NOTIFICATION_BODY_MAX,
  previewLine,
  routineNotification,
  turnNotification
} from './notification-text'

describe('previewLine', () => {
  it('collapses a streamed reply into one line', () => {
    expect(previewLine('Two things.\n\nFirst,   the cache.')).toBe('Two things. First, the cache.')
  })

  it('clamps with an ellipsis at the cap', () => {
    const line = previewLine('x'.repeat(500))
    expect(line).toHaveLength(NOTIFICATION_BODY_MAX)
    expect(line.endsWith('…')).toBe(true)
  })

  it('leaves a short line untouched', () => {
    expect(previewLine('done')).toBe('done')
  })
})

describe('routineNotification', () => {
  it("leads the body with the prompt preview, since that is the routine's name", () => {
    const text = routineNotification('Fix flaky tests', {
      status: 'completed',
      summary: 'Stabilised two retries. Opened PR #12.'
    })

    expect(text.title).toBe('Routine finished')
    expect(text.body).toBe('Fix flaky tests · Stabilised two retries. Opened PR #12.')
  })

  // The summary already carries its own register ("Failed — …"); the body
  // quotes it rather than rephrasing, so there is one account of the run.
  it('titles a failure as a failure and quotes the summary', () => {
    const text = routineNotification('Nightly sweep', {
      status: 'failed',
      summary: 'Failed — rate limited.'
    })

    expect(text.title).toBe('Routine failed')
    expect(text.body).toContain('Failed — rate limited.')
  })

  it('distinguishes a skip from a failure', () => {
    const text = routineNotification('Nightly sweep', {
      status: 'skipped',
      summary: 'Skipped — Refactor Buddy is already working in this repo.'
    })

    expect(text.title).toBe('Routine skipped')
  })
})

describe('turnNotification', () => {
  it('reads as a message from the persona', () => {
    const text = turnNotification('Refactor Buddy', 'Moved the cache to a module.', null)

    expect(text.title).toBe('Refactor Buddy')
    expect(text.body).toBe('Moved the cache to a module.')
  })

  it('says so when the turn failed', () => {
    const text = turnNotification('Refactor Buddy', '', 'Connection reset.')

    expect(text.title).toBe('Refactor Buddy hit a problem')
    expect(text.body).toBe('Connection reset.')
  })

  // An aborted or tool-only turn can end with no text at all; an empty body
  // renders as a blank toast, which reads as a bug.
  it('never produces an empty body', () => {
    expect(turnNotification('Refactor Buddy', '', null).body).not.toBe('')
  })
})

describe('budgetNotification', () => {
  it('states the crossing plainly when every turn was priced', () => {
    const text = budgetNotification('Switchboard', 26.4, 25, false)

    expect(text.title).toBe('Monthly budget crossed')
    expect(text.body).toContain('has spent $26.40 of your $25.00')
    expect(text.body).not.toContain('at least')
  })

  // The dashboard's `$12.34+` rule, in words: with unpriced turns the figure
  // is a floor, and claiming it as a total would be a guess.
  it('says "at least" when the month holds unpriced turns', () => {
    const text = budgetNotification('Nightly sweep', 10, 8, true)
    expect(text.body).toContain('at least $10.00 of your $8.00')
  })

  it('tells the user nothing was stopped', () => {
    expect(budgetNotification('Switchboard', 26.4, 25, false).body).toContain(
      'Nothing has been stopped.'
    )
  })
})
