import { describe, expect, it } from 'vitest'
import { groupRetryTarget, hasUnansweredTail } from './turn-tail'

describe('hasUnansweredTail', () => {
  it('is false for an empty thread', () => {
    expect(hasUnansweredTail([], false)).toBe(false)
  })

  it('is false when the tail is an assistant reply', () => {
    expect(hasUnansweredTail([{ role: 'user' }, { role: 'assistant' }], false)).toBe(false)
  })

  it('is true for a trailing user message with nothing in flight', () => {
    expect(hasUnansweredTail([{ role: 'user' }], false)).toBe(true)
  })

  // The live turn IS the answer arriving — a notice under a streaming bubble
  // would claim the turn died while the user watches it run.
  it('is false while a turn is live, whatever the tail', () => {
    expect(hasUnansweredTail([{ role: 'user' }], true)).toBe(false)
  })

  it('recognises a group thread ending in a user_mention', () => {
    expect(hasUnansweredTail([{ type: 'system_summary' }, { type: 'user_mention' }], false)).toBe(
      true
    )
  })

  it('is false when a group reply followed the mention', () => {
    expect(hasUnansweredTail([{ type: 'user_mention' }, { type: 'agent_reply' }], false)).toBe(
      false
    )
  })
})

describe('groupRetryTarget', () => {
  const mentionTail = [{ type: 'system_summary' }, { type: 'user_mention' }]

  it('is null unless the thread ends in a user_mention', () => {
    expect(
      groupRetryTarget(
        [{ type: 'user_mention' }, { type: 'agent_reply' }],
        [{ contactId: 'a', role: 'user', timestamp: 1 }],
        ['a'],
        []
      )
    ).toBeNull()
    expect(groupRetryTarget([], [], [], [])).toBeNull()
  })

  it('targets the member whose own thread has the unanswered user row', () => {
    const previews = [
      { contactId: 'a', role: 'assistant', timestamp: 5 },
      { contactId: 'b', role: 'user', timestamp: 3 }
    ]
    expect(groupRetryTarget(mentionTail, previews, ['a', 'b'], [])).toBe('b')
  })

  it('prefers the most recent unanswered member when several qualify', () => {
    const previews = [
      { contactId: 'a', role: 'user', timestamp: 3 },
      { contactId: 'b', role: 'user', timestamp: 9 }
    ]
    expect(groupRetryTarget(mentionTail, previews, ['a', 'b'], [])).toBe('b')
  })

  it('ignores contacts outside the group', () => {
    const previews = [{ contactId: 'elsewhere', role: 'user', timestamp: 9 }]
    expect(groupRetryTarget(mentionTail, previews, ['a'], [])).toBeNull()
  })

  it('never targets a member whose turn is still running', () => {
    const previews = [{ contactId: 'a', role: 'user', timestamp: 9 }]
    expect(groupRetryTarget(mentionTail, previews, ['a'], ['a'])).toBeNull()
  })
})
