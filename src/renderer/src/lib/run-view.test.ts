import { describe, expect, it } from 'vitest'
import { originLabel, routineRun, runTarget } from './run-view'
import type { ActiveRun } from '../../../shared/ipc-contract'

function run(overrides: Partial<ActiveRun> = {}): ActiveRun {
  return {
    runId: 'run-1',
    contactId: 'contact-a',
    contactName: 'Refactor Buddy',
    workingPath: '/repo',
    mode: 'exclusive',
    startedAt: 1_700_000_000_000,
    origin: 'message',
    routineId: null,
    groupId: null,
    approval: null,
    ...overrides
  }
}

describe('routineRun', () => {
  it('finds the run a routine is responsible for', () => {
    const runs = [
      run(),
      run({ runId: 'run-2', origin: 'routine', routineId: 'routine-9', contactId: 'contact-b' })
    ]
    expect(routineRun(runs, 'routine-9')?.runId).toBe('run-2')
  })

  it("never claims another routine's run, or a chat on the same contact", () => {
    // The same contact mid-chat must not make its routine read as running.
    const runs = [run({ contactId: 'contact-b' })]
    expect(routineRun(runs, 'routine-9')).toBeUndefined()
    expect(
      routineRun([run({ origin: 'routine', routineId: 'routine-other' })], 'routine-9')
    ).toBeUndefined()
  })
})

describe('originLabel', () => {
  it('says chat for a typed message, and names the rest as they are', () => {
    expect(originLabel('message')).toBe('chat')
    expect(originLabel('mention')).toBe('mention')
    expect(originLabel('routine')).toBe('routine')
  })
})

describe('runTarget', () => {
  it('lands a mention in the group it was sent from', () => {
    expect(runTarget(run({ origin: 'mention', groupId: 'group-1' }))).toEqual({
      kind: 'group',
      id: 'group-1'
    })
  })

  it('lands chats and routines in the contact thread', () => {
    expect(runTarget(run())).toEqual({ kind: 'contact', id: 'contact-a' })
    expect(runTarget(run({ origin: 'routine', routineId: 'routine-9' }))).toEqual({
      kind: 'contact',
      id: 'contact-a'
    })
  })

  it('falls back to the contact when a mention run somehow lacks its group', () => {
    expect(runTarget(run({ origin: 'mention', groupId: null }))).toEqual({
      kind: 'contact',
      id: 'contact-a'
    })
  })
})
