import type { UsageEvent, UsageSummary } from '@/types'

export function aggregateUsage(events: UsageEvent[]): UsageSummary {
  let totalCostUsd: number | null = null
  let totalInputTokens = 0
  let totalOutputTokens = 0
  let totalCachedInputTokens = 0
  let hasCachedTokens = false

  for (const event of events) {
    if (event.costUsd !== null) {
      totalCostUsd = (totalCostUsd ?? 0) + event.costUsd
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
    ...(hasCachedTokens ? { totalCachedInputTokens } : {})
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
 * Codex reports token counts but no dollar figure (blueprint §3), so any
 * summary can legitimately have a null cost. Formatting has to say so rather
 * than printing $0.00 and implying the work was free.
 */
export function formatCost(costUsd: number | null): string {
  if (costUsd === null) return '—'
  if (costUsd === 0) return '$0.00'
  return costUsd < 0.01 ? '<$0.01' : `$${costUsd.toFixed(2)}`
}

export function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}k`
  return `${tokens}`
}
