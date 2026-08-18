import type { ConversationSelection } from '@/store/useUiStore'

/**
 * Walking the conversation list from the keyboard (⌥↑ / ⌥↓).
 *
 * The ordering itself is not recomputed here. `ConversationList` already
 * derives the rendered order — contacts then repo groups, each `byRecency`,
 * both narrowed by the panel's filter box — and this takes that array as given.
 * That is the whole point: a second ordering computed from the same inputs is a
 * second chance to disagree with the list, and the failure would be a shortcut
 * that skips a row the user is looking straight at. Phase 22 fixed exactly that
 * shape of bug in the composer's lock check, where the renderer predicted
 * main's answer instead of asking for it.
 *
 * So the rule is "⌥↑/⌥↓ move to the next row *you can see*". A filtered list is
 * walked as filtered, and when the panel is not on screen at all the binding is
 * not registered — the list is the thing being navigated, and navigating one
 * that isn't there has no meaning to give the user.
 */

/** A row in the rendered order, in the shape the UI store selects by. */
export type ConversationRef = NonNullable<ConversationSelection>

export function sameConversation(a: ConversationSelection, b: ConversationSelection): boolean {
  if (a === null || b === null) return a === b
  return a.kind === b.kind && a.id === b.id
}

/**
 * The row `delta` steps away from `current`, or null when there is nowhere to
 * go.
 *
 * Wraps at both ends. A switchboard holds a handful of conversations rather
 * than a mail spool, so cycling is cheap and the alternative is worse: a key
 * that silently stops working once you reach the last row is indistinguishable
 * from a key that is broken, and the user has no way to tell which they have.
 *
 * A selection that is not in the order — nothing selected yet, or a row the
 * filter box has just hidden — enters the list from the end you were heading
 * for rather than being treated as an error. Pressing "next" with no selection
 * lands on the first row, which is the only answer that needs no explanation.
 */
export function stepConversation(
  order: readonly ConversationRef[],
  current: ConversationSelection,
  delta: 1 | -1
): ConversationRef | null {
  if (order.length === 0) return null

  const index = order.findIndex((row) => sameConversation(row, current))
  if (index === -1) return delta === 1 ? order[0] : order[order.length - 1]

  // `+ order.length` before the modulo: JavaScript's % keeps the sign of the
  // dividend, so stepping back from index 0 would otherwise be -1 rather than
  // the last row.
  return order[(index + delta + order.length) % order.length]
}
