import { describe, expect, it } from 'vitest'
import { awaitingFreshSession, sessionBoundaries } from './session'

/**
 * Written from the claim the divider makes on screen — "nothing above this line
 * is in memory" — rather than from the walk that produces it.
 *
 * The claim is falsifiable in exactly one direction that matters: a divider the
 * app cannot prove. Null means "not recorded", and most of these cases are
 * about refusing to turn an absence of evidence into a statement about the
 * model's memory.
 */

const row = (sessionId?: string | null): { sessionId?: string | null } =>
  sessionId === undefined ? {} : { sessionId }

describe('sessionBoundaries', () => {
  it('finds nothing in an empty thread', () => {
    expect(sessionBoundaries([])).toEqual(new Set())
  })

  it('finds nothing when one session answered everything', () => {
    expect(sessionBoundaries([row('a'), row('a'), row('a')])).toEqual(new Set())
  })

  it('marks the first row of the new session, not the last of the old', () => {
    // The divider reads "nothing above is in memory", so it belongs above the
    // first message the new session answered.
    expect(sessionBoundaries([row('a'), row('a'), row('b'), row('b')])).toEqual(new Set([2]))
  })

  it('marks every change, not just the first', () => {
    expect(sessionBoundaries([row('a'), row('b'), row('c')])).toEqual(new Set([1, 2]))
  })

  // The upgrade case, and the reason for the whole null rule: a profile with a
  // year of unrecorded history must open to no dividers at all.
  it('draws nothing across a thread that predates the column', () => {
    expect(sessionBoundaries([row(null), row(null), row(null), row()])).toEqual(new Set())
  })

  // A crashed turn leaves nulls in the middle of a recorded thread. The app
  // cannot say whether the session survived, so it says nothing — rather than
  // claiming a boundary at every gap in its own record.
  it('lets an unrecorded turn inherit instead of splitting the thread', () => {
    expect(sessionBoundaries([row('a'), row(null), row('a')])).toEqual(new Set())
  })

  it('still finds a real change either side of an unrecorded turn', () => {
    expect(sessionBoundaries([row('a'), row(null), row('b')])).toEqual(new Set([2]))
  })

  // The tail of a migrated profile: old rows unrecorded, then the app starts
  // stamping. The first stamped row is not evidence that anything changed.
  it('does not treat the first recorded session as a boundary', () => {
    expect(sessionBoundaries([row(null), row(null), row('a'), row('a')])).toEqual(new Set())
  })

  it('never marks the very first row', () => {
    expect(sessionBoundaries([row('a')])).toEqual(new Set())
    expect(sessionBoundaries([row('a'), row('b')])).toEqual(new Set([1]))
  })
})

describe('awaitingFreshSession', () => {
  // The durable trace of "start fresh" is the cleared key itself — which is why
  // the action needs no marker row to be visible immediately.
  it('is true once the resume key is cleared on a thread with history', () => {
    expect(awaitingFreshSession(null, 4)).toBe(true)
  })

  it('is false while a session is live', () => {
    expect(awaitingFreshSession('session-abc', 4)).toBe(false)
  })

  // A brand-new contact has no key either, and saying "the next message starts
  // a new session" there would be describing nothing.
  it('is false on a conversation that has not started', () => {
    expect(awaitingFreshSession(null, 0)).toBe(false)
  })
})
