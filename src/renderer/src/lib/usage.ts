import type { PersonaBackend, UsageEvent, UsageSummary } from '@/types'

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
  // A deleted Contact's spend has no id to match and so is not counted here.
  // These two functions answer "what did this Contact cost"; the dashboard's
  // unscoped totals are where orphaned spend stays visible.
  return aggregateUsage(
    events.filter((event) => event.contactId !== null && ids.has(event.contactId))
  )
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

export interface ContextTokens {
  /** input + cached + cache-write: the whole prompt the backend was handed. */
  promptTokens: number
  /** How many recorded turns went into that figure. */
  turns: number
  /** The newest turn counted, so the panel can say how fresh this is. */
  at: number
  model: string | null
  /** Which arithmetic was used, so the UI can say which — see below. */
  reading: 'last-turn' | 'session-sum'
}

/**
 * How large this contact's prompt currently is, read from what was billed.
 *
 * The two backends record incompatible things and the difference is not
 * cosmetic — it is the whole reason this branches rather than summing.
 *
 * **Claude** re-sends the entire conversation every turn, so one row's
 * `inputTokens` *is* the prompt. Summing rows would count the same prompt once
 * per turn and produce a figure several times too large.
 *
 * **Codex** reports cumulatively across a thread, and `recordUsage` stores the
 * delta — see `deltaFrom` and `usageBaseline` in src/main/adapters/codex.ts. So
 * one row is that turn's increment, and only the sum is the prompt.
 *
 * Scoped to `sessionId`, because a prompt belongs to a session: rows from a
 * session that has ended describe a conversation the backend has forgotten.
 * Returns null when there is no session yet — nothing is in context until a
 * turn has run, and rendering that as 0 would suggest an empty prompt rather
 * than no prompt at all.
 *
 * Deliberately returns **no percentage**. There is no per-model context-window
 * table anywhere in this app, and inventing one to divide by would be a guess
 * presented as a measurement. (`LONG_CONTEXT_THRESHOLD` in pricing.ts is a
 * Codex pricing tier boundary, not a limit.)
 */
export function contextTokens(
  events: UsageEvent[],
  sessionId: string | null,
  backend: PersonaBackend
): ContextTokens | null {
  if (!sessionId) return null

  const forSession = events.filter((event) => event.sessionId === sessionId)
  if (forSession.length === 0) return null

  const promptOf = (event: UsageEvent): number =>
    event.inputTokens + (event.cachedInputTokens ?? 0) + (event.cacheWriteInputTokens ?? 0)

  // Found explicitly rather than by trusting usage.list's ordering: a caller
  // that filtered or re-sorted first would otherwise silently get the wrong
  // turn, and the number would still look plausible.
  const newest = forSession.reduce((latest, event) =>
    event.timestamp >= latest.timestamp ? event : latest
  )

  return backend === 'codex'
    ? {
        promptTokens: forSession.reduce((total, event) => total + promptOf(event), 0),
        turns: forSession.length,
        at: newest.timestamp,
        model: newest.model ?? null,
        reading: 'session-sum'
      }
    : {
        promptTokens: promptOf(newest),
        turns: forSession.length,
        at: newest.timestamp,
        model: newest.model ?? null,
        reading: 'last-turn'
      }
}
