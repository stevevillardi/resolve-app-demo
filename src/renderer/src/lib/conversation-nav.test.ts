import { describe, expect, it } from 'vitest'
import { sameConversation, stepConversation, type ConversationRef } from './conversation-nav'

/**
 * The claims worth pinning are the edges, not the middle: an empty list, a
 * selection the filter box just hid, and both ends of the wrap. The middle case
 * is one array index and would pass against almost any implementation.
 */

const order: ConversationRef[] = [
  { kind: 'contact', id: 'a' },
  { kind: 'contact', id: 'b' },
  { kind: 'group', id: 'g1' }
]

describe('stepConversation', () => {
  it('moves to the next and previous row', () => {
    expect(stepConversation(order, { kind: 'contact', id: 'a' }, 1)).toEqual({
      kind: 'contact',
      id: 'b'
    })
    expect(stepConversation(order, { kind: 'group', id: 'g1' }, -1)).toEqual({
      kind: 'contact',
      id: 'b'
    })
  })

  /**
   * Contacts and groups share an id space only by accident, so the kind has to
   * be part of the comparison. Without it a group whose id happened to match a
   * contact's would be found at the wrong index and ⌥↓ would jump across the
   * list — a bug that needs two specific rows to reproduce and would otherwise
   * never show up in manual use.
   */
  it('distinguishes a contact from a group with the same id', () => {
    const collide: ConversationRef[] = [
      { kind: 'contact', id: 'x' },
      { kind: 'group', id: 'x' }
    ]
    expect(stepConversation(collide, { kind: 'group', id: 'x' }, -1)).toEqual({
      kind: 'contact',
      id: 'x'
    })
    // And the reverse, so this cannot pass by always preferring 'contact'.
    expect(stepConversation(collide, { kind: 'contact', id: 'x' }, 1)).toEqual({
      kind: 'group',
      id: 'x'
    })
  })

  // Wrapping rather than clamping: a key that goes dead at the last row reads
  // as broken, and the user cannot tell that from a key that is broken.
  it('wraps at both ends', () => {
    expect(stepConversation(order, { kind: 'group', id: 'g1' }, 1)).toEqual({
      kind: 'contact',
      id: 'a'
    })
    expect(stepConversation(order, { kind: 'contact', id: 'a' }, -1)).toEqual({
      kind: 'group',
      id: 'g1'
    })
  })

  it('enters the list from the end you were heading for', () => {
    expect(stepConversation(order, null, 1)).toEqual({ kind: 'contact', id: 'a' })
    expect(stepConversation(order, null, -1)).toEqual({ kind: 'group', id: 'g1' })
  })

  // The live case for the above: the filter box has narrowed the list and what
  // was selected is no longer in it. Stepping should still land somewhere real.
  it('recovers when the selection has been filtered out of the list', () => {
    expect(stepConversation(order, { kind: 'contact', id: 'gone' }, 1)).toEqual({
      kind: 'contact',
      id: 'a'
    })
  })

  it('has nowhere to go in an empty list', () => {
    expect(stepConversation([], null, 1)).toBeNull()
    expect(stepConversation([], { kind: 'contact', id: 'a' }, -1)).toBeNull()
  })

  // One row: both directions are the row you are already on, and neither is
  // null — the caller sets the same selection again, which is a no-op rather
  // than a cleared thread.
  it('stays put in a list of one', () => {
    const single: ConversationRef[] = [{ kind: 'contact', id: 'only' }]
    expect(stepConversation(single, single[0], 1)).toEqual(single[0])
    expect(stepConversation(single, single[0], -1)).toEqual(single[0])
  })
})

describe('sameConversation', () => {
  it('compares kind and id together', () => {
    expect(sameConversation({ kind: 'contact', id: 'a' }, { kind: 'contact', id: 'a' })).toBe(true)
    expect(sameConversation({ kind: 'contact', id: 'a' }, { kind: 'group', id: 'a' })).toBe(false)
    expect(sameConversation({ kind: 'contact', id: 'a' }, { kind: 'contact', id: 'b' })).toBe(false)
  })

  it('treats null as a value rather than as no answer', () => {
    expect(sameConversation(null, null)).toBe(true)
    expect(sameConversation(null, { kind: 'contact', id: 'a' })).toBe(false)
  })
})
