import { randomUUID } from 'crypto'
import { and, count, desc, eq, isNotNull, sql } from 'drizzle-orm'
import { initDb } from '../db'
import { toUsageEvent } from '../db/mappers'
import { contacts, usageEvents } from '../db/schema'
import { emitUsageChanged } from './agent-events'
import { checkBudgetsAfterUsage } from './budget-alerts'
import type { AgentUsage } from '../../shared/agent'
import type { ContactUsageSummary, UsageEvent, UsageSource } from '../../shared/domain'

/**
 * Per-turn spend.
 *
 * Logged per turn and never aggregated in place, deliberately: one row per turn
 * keeps the full history a spend-over-time view needs, and there is no running
 * total for two concurrent turns to race on. Every turn — message, mention,
 * routine fire and compaction's own summary — writes here, and the usage
 * dashboard and the budget alerts read it back.
 */

export function listUsageEvents(contactId?: string): UsageEvent[] {
  const query = initDb().select().from(usageEvents).$dynamic()
  const rows = contactId
    ? query.where(eq(usageEvents.contactId, contactId)).orderBy(desc(usageEvents.timestamp)).all()
    : query.orderBy(desc(usageEvents.timestamp)).all()
  return rows.map(toUsageEvent)
}

/**
 * Every contact's spend, rolled up in SQL (Phase 25 §B1).
 *
 * The conversation rail and the usage rail both used to answer "what has this
 * cost" by fetching `usage.list` — the whole table, unbounded — and scanning it
 * once per row in the renderer. That is O(rows × events) redone on every render,
 * and it grows with exactly the two things a fleet accumulates. The rail needs
 * one number per contact, so one number per contact is what it now asks for.
 *
 * Modelled on `unreadCounts()`, which is the other place in this app where the
 * question is an aggregate and the answer belongs in the database.
 *
 * **Every clause here mirrors a rule `aggregateUsage` already enforced**, and
 * the two are pinned to each other by test rather than by inspection — this is
 * a second implementation of a spend calculation, and the way that goes wrong
 * is by disagreeing quietly.
 *
 * - `SUM(cost_usd)` returns NULL when no row was priced, which is exactly
 *   `totalCostUsd: null` — "unknown", not "free". Deliberately no COALESCE.
 * - unpriced and priced are counted separately, because a total with unpriced
 *   turns behind it is a floor and `formatCostSummary` prints the `+` that says
 *   so. Losing that count is how `$12.34+` silently becomes `$12.34`.
 * - `COUNT(cached_input_tokens)` counts non-nulls, so zero means no turn ever
 *   reported caching and the field is omitted rather than sent as 0. "The
 *   backend never told us" is not "nothing was cached".
 *
 * Grouped by contact only. A group's figure is its members' summed and a
 * persona's is its contacts', so the caller composes rather than this returning
 * three groupings to keep in step. Spend whose Contact was deleted has no id to
 * group under and is absent — which is what the renderer's own filter did with
 * it, and why the dashboard's unscoped totals stay the place orphaned spend
 * remains visible.
 */
export function usageSummariesByContact(): ContactUsageSummary[] {
  const rows = initDb()
    .select({
      contactId: usageEvents.contactId,
      totalCostUsd: sql<number | null>`sum(${usageEvents.costUsd})`,
      totalInputTokens: sql<number>`sum(${usageEvents.inputTokens})`,
      totalOutputTokens: sql<number>`sum(${usageEvents.outputTokens})`,
      totalCachedInputTokens: sql<number | null>`sum(${usageEvents.cachedInputTokens})`,
      cachedRows: count(usageEvents.cachedInputTokens),
      pricedEvents: count(usageEvents.costUsd),
      unpricedEvents: sql<number>`sum(case when ${usageEvents.costUsd} is null then 1 else 0 end)`
    })
    .from(usageEvents)
    // Orphaned spend has no contact to attribute to. Excluded here rather than
    // grouped under a null key, so the caller cannot accidentally render it as
    // one mystery contact.
    .where(isNotNull(usageEvents.contactId))
    .groupBy(usageEvents.contactId)
    .all()

  return rows.map((row) => ({
    contactId: row.contactId as string,
    totalCostUsd: row.totalCostUsd,
    totalInputTokens: row.totalInputTokens,
    totalOutputTokens: row.totalOutputTokens,
    // The omission is the signal — see the schema comment in domain.ts.
    ...(row.cachedRows > 0 ? { totalCachedInputTokens: row.totalCachedInputTokens ?? 0 } : {}),
    unpricedEvents: row.unpricedEvents,
    pricedEvents: row.pricedEvents
  }))
}

/**
 * Writes one turn's usage exactly as the adapter reported it.
 *
 * Nothing is recomputed here, and that is the point. Claude's figure comes from
 * the SDK's own price table and Codex's from src/main/adapters/pricing.ts; both
 * were settled against real turns. Re-deriving either at this layer would
 * replace a measured number with a guess — and what happens when you try was
 * measured too: summing Claude's per-step assistant messages reads 80x low,
 * because that `usage` field is a running snapshot rather than a per-step
 * total.
 *
 * `costUsd: null` is carried through as null. It means "this model has no
 * published price", which is not the same as free, and rendering it as 0 would
 * quietly under-report a demo's spend.
 */
export function recordUsage(
  contactId: string,
  source: UsageSource,
  usage: AgentUsage,
  sessionId?: string | null,
  routineId?: string | null,
  /**
   * The assistant message this turn produced, when it produced one, so a usage
   * row links back to the reply it paid for rather than only to an aggregate.
   *
   * Optional because two callers legitimately have nothing to pass: a turn that
   * ends without final text is still billable, and compaction's `summary` spend
   * has no message to point at. Null on the row means exactly that — see the
   * column comment in schema.ts for why a timestamp pairing was rejected.
   */
  messageId?: string | null
): UsageEvent {
  // Read once and copied onto the row, so the two questions the dashboard asks
  // of historical spend — whose, and on which repo — outlive the Contact.
  // Resolved here rather than at read time precisely because a join cannot
  // answer them once the Contact is gone.
  const contact = initDb().select().from(contacts).where(eq(contacts.id, contactId)).get()

  const event: UsageEvent = {
    id: randomUUID(),
    contactId,
    ...(contact
      ? { personaTemplateId: contact.personaTemplateId, repoPath: contact.repoPath }
      : {}),
    timestamp: Date.now(),
    source,
    ...(sessionId ? { sessionId } : {}),
    ...(messageId ? { messageId } : {}),
    // Recorded because a per-routine budget needs to know which routine spent
    // what; the id is in hand at the call site either way, since TurnOrigin
    // carries it.
    ...(routineId ? { routineId } : {}),
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    costUsd: usage.costUsd,
    costSource: usage.costSource,
    ...(usage.cachedInputTokens !== undefined && { cachedInputTokens: usage.cachedInputTokens }),
    ...(usage.cacheWriteInputTokens !== undefined && {
      cacheWriteInputTokens: usage.cacheWriteInputTokens
    }),
    ...(usage.reasoningOutputTokens !== undefined && {
      reasoningOutputTokens: usage.reasoningOutputTokens
    }),
    // The model that actually served the turn, which is not always the one the
    // persona asked for — a backend may substitute, and the cost was priced
    // against whatever ran.
    ...(usage.model !== undefined && { model: usage.model })
  }

  initDb()
    .insert(usageEvents)
    .values({ ...event, timestamp: new Date(event.timestamp) })
    .run()

  // After the insert, never before: the renderer reacts by refetching, so
  // announcing first would race the row it is announcing. Same ordering the
  // turn loop uses for `done`.
  //
  // Hard budget caps are deliberately not enforced anywhere in this app. What
  // hangs off this seam is a soft alert — see budget-alerts.ts, which honours
  // the rule this comment carries: a month with unpriced turns in it is only a
  // lower bound, so the alert says "at least $X" and no floor ever stops,
  // pauses or refuses anything. Wrapped because an alert must never fail the
  // turn whose spend it is reacting to.
  emitUsageChanged()
  try {
    checkBudgetsAfterUsage(event)
  } catch (error) {
    console.error('[budget] alert check failed', error)
  }

  return event
}

/**
 * What a backend has already been credited with for `sessionId` — the figure an
 * adapter subtracts to get one turn's own usage.
 *
 * Exists because **Codex reports usage cumulatively across a thread**, despite
 * `@openai/codex-sdk`'s own typings documenting every field as "during the
 * turn" (`dist/index.d.ts:119-131`). Measured over three one-word replies on a
 * single resumed thread:
 *
 *   turn 1   input 12122   output  5   cached  4480   $0.0406
 *   turn 2   input 25610   output 10   cached 16128   $0.0558
 *   turn 3   input 39114   output 15   cached 28800   $0.0664
 *
 * Output going 5 → 10 → 15 for three one-word replies is a running sum. Left
 * alone, every UsageEvent after the first over-reports by a margin that grows
 * with the conversation.
 *
 * Since every row this returns is itself already a delta, their sum *is* the
 * cumulative total the backend will report next — no separate cursor to keep in
 * step, and nothing to repair if a turn crashes before it records.
 *
 * Claude does not need this: its `total_cost_usd`/`modelUsage` were verified
 * per-turn under `resume` over the same three-turn shape (turn 3 cost *less*
 * than turn 2). It ignores the baseline.
 */
export function baselineFor(contactId: string, sessionId: string | null): AgentUsage | null {
  if (!sessionId) return null

  const rows = initDb()
    .select()
    .from(usageEvents)
    .where(and(eq(usageEvents.contactId, contactId), eq(usageEvents.sessionId, sessionId)))
    .all()

  if (rows.length === 0) return null

  return rows.reduce<AgentUsage>(
    (total, row) => ({
      inputTokens: total.inputTokens + row.inputTokens,
      outputTokens: total.outputTokens + row.outputTokens,
      cachedInputTokens: (total.cachedInputTokens ?? 0) + (row.cachedInputTokens ?? 0),
      cacheWriteInputTokens: (total.cacheWriteInputTokens ?? 0) + (row.cacheWriteInputTokens ?? 0),
      reasoningOutputTokens: (total.reasoningOutputTokens ?? 0) + (row.reasoningOutputTokens ?? 0),
      // Only the token counts are subtracted; cost is recomputed from the
      // delta, never differenced. Carried as null/'computed' to satisfy the
      // shape.
      costUsd: null,
      costSource: 'computed'
    }),
    {
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: 0,
      cacheWriteInputTokens: 0,
      reasoningOutputTokens: 0,
      costUsd: null,
      costSource: 'computed'
    }
  )
}
