/**
 * A rollup of UsageEvents for display — computed in the renderer by
 * lib/usage.ts, never stored. Blueprint §4 logs events per turn precisely so
 * totals stay derived rather than maintained.
 */
export interface UsageSummary {
  totalCostUsd: number | null
  totalInputTokens: number
  totalOutputTokens: number
  totalCachedInputTokens?: number
}
