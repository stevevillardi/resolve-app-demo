import { describe, expect, it } from 'vitest'
import { missingTurnRuns, staleTurnContacts } from './run-reconcile'

/**
 * A turn that finishes while no subscriber is mounted leaks its useRunStore
 * entry and renders as a "working…" block that outlives navigation and
 * remounts. These pin the decision half of the sweep: what is stale is exactly
 * what main no longer lists.
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

/**
 * The symmetric half. A routine fire (scheduled or Run now) and a renderer
 * reload mid-turn both produce active runs no renderer mutation ever began —
 * sweeping them in is what makes background work render live.
 */
describe('missingTurnRuns', () => {
  it('reports an active run the store has never heard of', () => {
    expect(missingTurnRuns({}, [{ runId: 'run-1', contactId: 'contact-a' }])).toEqual([
      { contactId: 'contact-a', runId: 'run-1' }
    ])
  })

  it('leaves a run the store already streams alone', () => {
    expect(
      missingTurnRuns({ 'contact-a': { runId: 'run-1' } }, [
        { runId: 'run-1', contactId: 'contact-a' }
      ])
    ).toEqual([])
  })

  it('never clobbers a contact already mid-turn, even under a different runId', () => {
    // The store is keyed by contact; adopting the new id would discard a live
    // stream for the same conversation.
    expect(
      missingTurnRuns({ 'contact-a': { runId: 'run-old' } }, [
        { runId: 'run-new', contactId: 'contact-a' }
      ])
    ).toEqual([])
  })

  it('adds and ignores independently across contacts', () => {
    expect(
      missingTurnRuns({ 'contact-a': { runId: 'run-1' } }, [
        { runId: 'run-1', contactId: 'contact-a' },
        { runId: 'run-2', contactId: 'contact-b' }
      ])
    ).toEqual([{ contactId: 'contact-b', runId: 'run-2' }])
  })
})
