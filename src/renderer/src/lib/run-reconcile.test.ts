import { describe, expect, it } from 'vitest'
import { staleTurnContacts } from './run-reconcile'

/**
 * Phase 11, F7: a turn that finished while no subscriber was mounted leaked
 * its useRunStore entry and rendered as a "working…" block that outlived
 * navigation and remounts. These pin the decision half of the sweep: what is
 * stale is exactly what main no longer lists.
 */
describe('staleTurnContacts', () => {
  it('names the contacts whose runs main no longer lists', () => {
    const byContact = {
      'contact-leaked': { runId: 'run-finished' },
      'contact-live': { runId: 'run-active' }
    }

    expect(staleTurnContacts(byContact, ['run-active'])).toEqual(['contact-leaked'])
  })

  it('keeps every entry main still vouches for', () => {
    const byContact = {
      a: { runId: 'run-1' },
      b: { runId: 'run-2' }
    }

    expect(staleTurnContacts(byContact, ['run-1', 'run-2', 'run-3'])).toEqual([])
  })

  it('declares everything stale when nothing is running at all', () => {
    // The live-run incident: runs.list returned [] while the store still held
    // the finished turn.
    expect(staleTurnContacts({ a: { runId: 'run-gone' } }, [])).toEqual(['a'])
  })

  it('has nothing to say about an empty store', () => {
    expect(staleTurnContacts({}, ['run-1'])).toEqual([])
  })
})
