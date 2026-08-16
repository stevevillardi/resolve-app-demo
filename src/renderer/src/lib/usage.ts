import type { UsageEvent, UsageSummary } from '@/types'

/**
 * Rolls a set of turns up into one displayable total.
 *
 * The load-bearing detail is what happens to a turn with no price. It is
 * *counted*, not skipped: `costUsd: null` means the model that served the turn
 * has no row in CODEX_PRICES (src/main/adapters/pricing.ts), so its spend is
 * unknown rather than zero. Summing only the priced turns and returning a bare
 * number — which this used to do — produces a confident `$12.34` that is
 * quietly short by however much the unpriced turns actually cost.
 *
 * formatCost was already careful to print `—` for a single unknown. Carrying
 * `unpricedEvents` through is what keeps that care intact once there is more
 * than one event; render it with formatCostSummary.
 */
export function aggregateUsage(events: UsageEvent[]): UsageSummary {
  let totalCostUsd: number | null = null
  let totalInputTokens = 0
  let totalOutputTokens = 0
  let totalCachedInputTokens = 0
  let hasCachedTokens = false
  let unpricedEvents = 0
  let pricedEvents = 0

  for (const event of events) {
    if (event.costUsd !== null) {
      totalCostUsd = (totalCostUsd ?? 0) + event.costUsd
      pricedEvents += 1
    } else {
      unpricedEvents += 1
    }
    totalInputTokens += event.inputTokens
    totalOutputTokens += event.outputTokens
    if (event.cachedInputTokens !== undefined) {
      hasCachedTokens = true
      totalCachedInputTokens += event.cachedInputTokens
    }
  }

  return {
    totalCostUsd,
    totalInputTokens,
    totalOutputTokens,
    ...(hasCachedTokens ? { totalCachedInputTokens } : {}),
    unpricedEvents,
    pricedEvents
  }
}

export function usageForContact(events: UsageEvent[], contactId: string): UsageSummary {
  return aggregateUsage(events.filter((event) => event.contactId === contactId))
}

export function usageForContacts(events: UsageEvent[], contactIds: string[]): UsageSummary {
  const ids = new Set(contactIds)
  return aggregateUsage(events.filter((event) => ids.has(event.contactId)))
}

/**
 * A single cost, formatted.
 *
 * `null` prints as `—` rather than `$0.00`: since Phase 5 both backends yield a
 * dollar figure — Claude's from its SDK, Codex's computed from our own price
 * table — so a null is a model we have no price for, not a backend that cannot
 * tell us. Showing it as zero would read as "this turn was free".
 *
 * Prefer formatCostSummary anywhere the number came from more than one turn.
 */
export function formatCost(costUsd: number | null): string {
  if (costUsd === null) return '—'
  if (costUsd === 0) return '$0.00'
  return costUsd < 0.01 ? '<$0.01' : `$${costUsd.toFixed(2)}`
}

/**
 * A rolled-up cost, formatted so a partial total cannot pass for a complete one.
 *
 * The trailing `+` is the whole point: `$12.34+` says "at least this much, and
 * some turns are missing", which is the honest reading of a total that excludes
 * every unpriced turn. A total that is clear about what it leaves out beats one
 * that is quietly wrong.
 */
export function formatCostSummary(summary: UsageSummary): string {
  const { totalCostUsd, unpricedEvents } = summary
  // Nothing priced at all: `—` already says unknown, and `—+` is noise.
  if (totalCostUsd === null) return '—'
  return unpricedEvents > 0 ? `${formatCost(totalCostUsd)}+` : formatCost(totalCostUsd)
}

export function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}k`
  return `${tokens}`
}
