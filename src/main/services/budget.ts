/**
 * Monthly budget arithmetic, pure (Phase 20, review §C3).
 *
 * The money rules mirror the renderer's `aggregateUsage` on purpose: a null
 * `costUsd` means "no published price", which is not the same as free — so a
 * month's figure is a *floor* over its priced rows, and whether unpriced rows
 * exist travels beside it. Duplicating those semantics here rather than
 * importing them is deliberate: main code cannot import renderer lib, and the
 * alternative — summing nulls as zeros — is exactly the bug the seam comment
 * in usage-events.ts warns about.
 *
 * No db, no electron. budget-alerts.ts owns the side effects.
 */

/** Local-calendar month start — midnight on the 1st, DST-safe by setDate. */
export function monthStart(now: number): number {
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  start.setDate(1)
  return start.getTime()
}

/** `2026-08` — the sticky edge-trigger key. Local, like monthStart. */
export function monthKey(now: number): string {
  const date = new Date(now)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

export interface MonthlyFloor {
  /** Sum of the month's priced rows only — a lower bound, not a total. */
  floorUsd: number
  /** True when the month also holds rows with no published price. */
  hasUnpriced: boolean
}

export function monthlyFloor(
  events: { timestamp: number; costUsd: number | null }[],
  now: number
): MonthlyFloor {
  const from = monthStart(now)
  let floorUsd = 0
  let hasUnpriced = false

  for (const event of events) {
    if (event.timestamp < from || event.timestamp > now) continue
    if (event.costUsd === null) hasUnpriced = true
    else floorUsd += event.costUsd
  }
  return { floorUsd, hasUnpriced }
}

/**
 * Whether a soft alert should be considered at all.
 *
 * Comparing the *floor* is sound for an alert in a way it would not be for a
 * cap: "you have spent at least $X" crossing $Y is a true, actionable
 * statement, while refusing work on a lower bound would punish unpriced
 * models. The corollary is accepted, not patched: a month that is 100%
 * unpriced has a floor of $0 and never alerts.
 */
export function crossedBudget(floorUsd: number, budgetUsd: number): boolean {
  return budgetUsd > 0 && floorUsd >= budgetUsd
}
