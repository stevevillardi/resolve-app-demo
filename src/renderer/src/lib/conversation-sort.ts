/**
 * The conversation list's order: most recent message first, the iMessage rule.
 * An app whose sidebar is "conversations" must not sort them like a phone book
 * — the thread you touched a minute ago is the one you are coming back to.
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
