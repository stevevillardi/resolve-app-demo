/**
 * A rollup of UsageEvents for display — computed in the renderer by
 * lib/usage.ts, never stored. Usage is logged one event per turn precisely so
 * totals stay derived rather than maintained.
 */
export interface UsageSummary {
  /**
   * The sum of every *priced* turn, or null when none of them were priced.
   *
   * Read it with `unpricedEvents` or not at all. On its own it is the answer to
   * a narrower question than it looks like — "what did the turns we can price
   * cost", not "what did this cost" — and the two diverge silently the moment a
   * persona runs on a model missing from CODEX_PRICES.
   */
  totalCostUsd: number | null
  totalInputTokens: number
  totalOutputTokens: number
  totalCachedInputTokens?: number
  /**
   * How many turns carried `costUsd: null` and are therefore missing from
   * `totalCostUsd`. Non-zero means the total is a floor, not a figure — see
   * formatCostSummary, which is what should render it.
   */
  unpricedEvents: number
  /** How many turns *did* contribute. `0` with events present means all unpriced. */
  pricedEvents: number
}
