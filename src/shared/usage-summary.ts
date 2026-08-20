import type { ContactUsageSummary, UsageEvent, UsageSummary } from './domain'

/**
 * The rules for rolling turns up into a total, in one place (Phase 25 §B1).
 *
 * Shared rather than renderer-local because there are now two implementations of
 * this arithmetic — these functions, and the `GROUP BY` in
 * `services/usage-events.ts` that the conversation and usage rails read instead
 * of every raw event. Two implementations of one rule disagree quietly, so the
 * test that pins them together lives in the main project and runs the real SQL;
 * that test can only import from here, never from the renderer.
 *
 * Every function below turns on the same two distinctions, and both are about
 * refusing to invent a fact:
 *
 *   - an unpriced turn is **unknown**, never free
 *   - an unreported cached figure is **absent**, never zero
 */

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

/**
 * Adds already-rolled-up summaries together (Phase 25 §B1).
 *
 * The one composition step `usage.summaries` needs: it returns a figure per
 * Contact, and every other scope the app shows — a repo group, a persona, "all
 * personas" — is some set of Contacts added up.
 *
 * Every rule `aggregateUsage` enforces has to survive being applied twice, and
 * two of them only bite here:
 *
 * - **null is absorbing in one direction only.** A scope where nothing was
 *   priced stays null ("unknown"); a scope where *some* turn was priced reports
 *   that partial sum plus the unpriced count, which `formatCostSummary` renders
 *   with the trailing `+`. Treating null as 0 while summing would turn "we do
 *   not know what half of this cost" into a confident understatement.
 * - **an absent cached figure is not a zero one.** The field appears on the
 *   result only if at least one input carried it, so a group containing one
 *   caching backend and one silent one still reports what it knows, and a group
 *   where nobody reported caching reports nothing.
 *
 * An empty list rolls up to the zero summary rather than to null, and callers
 * are expected to check emptiness themselves — the rail shows no badge at all
 * for a contact that has never run, which is a different thing from a badge
 * reading `—`.
 */
export function combineUsage(summaries: UsageSummary[]): UsageSummary {
  let totalCostUsd: number | null = null
  let totalInputTokens = 0
  let totalOutputTokens = 0
  let totalCachedInputTokens = 0
  let hasCachedTokens = false
  let unpricedEvents = 0
  let pricedEvents = 0

  for (const summary of summaries) {
    if (summary.totalCostUsd !== null) {
      totalCostUsd = (totalCostUsd ?? 0) + summary.totalCostUsd
    }
    totalInputTokens += summary.totalInputTokens
    totalOutputTokens += summary.totalOutputTokens
    if (summary.totalCachedInputTokens !== undefined) {
      hasCachedTokens = true
      totalCachedInputTokens += summary.totalCachedInputTokens
    }
    unpricedEvents += summary.unpricedEvents
    pricedEvents += summary.pricedEvents
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

/**
 * The summaries for a set of Contacts, or undefined when none of them has spent.
 *
 * Undefined rather than a zeroed summary, which is the rule the raw-event
 * version enforced by checking `events.some(...)` first: a contact that has
 * never taken a turn gets no cost badge at all, because `$0.00` claims a turn
 * happened and was free.
 */
export function summariesFor(
  byContact: Map<string, ContactUsageSummary>,
  contactIds: string[]
): UsageSummary | undefined {
  const found = contactIds
    .map((id) => byContact.get(id))
    .filter((summary): summary is ContactUsageSummary => summary !== undefined)

  return found.length > 0 ? combineUsage(found) : undefined
}

/** `usage.summaries` indexed by contact, which is how every caller reads it. */
export function byContactId(summaries: ContactUsageSummary[]): Map<string, ContactUsageSummary> {
  return new Map(summaries.map((summary) => [summary.contactId, summary]))
}
