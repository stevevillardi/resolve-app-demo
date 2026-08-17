/**
 * The conversation list's order (Phase 20): most recent message first, the
 * iMessage rule — an app whose sidebar is "conversations" had been sorting
 * them like a phone book. A user decision recorded in the phase doc.
 *
 * Rows that have never had a message sort after every row that has, and
 * alphabetically among themselves — a stable, predictable tail rather than an
 * arbitrary one. Ties on timestamp (two conversations touched by the same
 * turn) also fall back to name, so re-renders cannot swap them.
 */
export function byRecency<T>(
  items: T[],
  timestampOf: (item: T) => number | undefined,
  nameOf: (item: T) => string
): T[] {
  return items.slice().sort((a, b) => {
    const at = timestampOf(a)
    const bt = timestampOf(b)
    if (at !== undefined && bt !== undefined && at !== bt) return bt - at
    if (at !== undefined && bt === undefined) return -1
    if (at === undefined && bt !== undefined) return 1
    return nameOf(a).localeCompare(nameOf(b))
  })
}
