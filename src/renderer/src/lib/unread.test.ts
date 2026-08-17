import { describe, expect, it } from 'vitest'
import { firstUnreadIndex, formatBadge, unreadByConversation } from './unread'

describe('unreadByConversation', () => {
  it('keys by kind and id so a contact and group cannot collide', () => {
    const map = unreadByConversation([
      { kind: 'contact', id: 'x', count: 2 },
      { kind: 'group', id: 'x', count: 5 }
    ])

    expect(map.get('contact:x')).toBe(2)
    expect(map.get('group:x')).toBe(5)
  })
})

describe('formatBadge', () => {
  it('shows the number up to two digits', () => {
    expect(formatBadge(1)).toBe('1')
    expect(formatBadge(99)).toBe('99')
  })

  it('caps at 99+ — past that, "a lot" is the message', () => {
    expect(formatBadge(100)).toBe('99+')
    expect(formatBadge(4000)).toBe('99+')
  })
})

describe('firstUnreadIndex', () => {
  const READ = 1_000

  it('finds the first row after the boundary', () => {
    const index = firstUnreadIndex(
      [
        { timestamp: 900, role: 'assistant' },
        { timestamp: 1_100, role: 'assistant' },
        { timestamp: 1_200, role: 'assistant' }
      ],
      READ
    )
    expect(index).toBe(1)
  })

  it('is nowhere when everything is read', () => {
    expect(firstUnreadIndex([{ timestamp: 900, role: 'assistant' }], READ)).toBe(-1)
  })

  // Matches the SQL: the boundary row was on screen when it was stamped.
  it('treats a row exactly at the boundary as read', () => {
    expect(firstUnreadIndex([{ timestamp: READ, role: 'assistant' }], READ)).toBe(-1)
  })

  // The divider says "new to you" — a message the user themselves sent after
  // the boundary is not that, and neither is their group mention.
  it("skips the user's own rows past the boundary", () => {
    const index = firstUnreadIndex(
      [
        { timestamp: 1_100, role: 'user' },
        { timestamp: 1_200, role: 'assistant' }
      ],
      READ
    )
    expect(index).toBe(1)

    const groupIndex = firstUnreadIndex(
      [
        { timestamp: 1_100, type: 'user_mention' },
        { timestamp: 1_200, type: 'agent_reply' }
      ],
      READ
    )
    expect(groupIndex).toBe(1)
  })

  it('is nowhere for a null boundary — everything reads as read', () => {
    expect(firstUnreadIndex([{ timestamp: 1_100, role: 'assistant' }], null)).toBe(-1)
  })
})
