import { randomUUID } from 'crypto'
import { and, desc, eq } from 'drizzle-orm'
import { initDb } from '../db'
import { toUsageEvent } from '../db/mappers'
import { contacts, usageEvents } from '../db/schema'
import { emitUsageChanged } from './agent-events'
import { checkBudgetsAfterUsage } from './budget-alerts'
import type { AgentUsage } from '../../shared/agent'
import type { UsageEvent, UsageSource } from '../../shared/domain'

/**
 * Per-turn spend (blueprint §4).
 *
 * Logged per turn and never aggregated in place, which §4 is explicit about:
 * it keeps a full history for the spend-over-time view and avoids racing on a
 * running total. Phase 10 reads these; Phase 6 writes the first ones.
 */

export function listUsageEvents(contactId?: string): UsageEvent[] {
  const query = initDb().select().from(usageEvents).$dynamic()
  const rows = contactId
    ? query.where(eq(usageEvents.contactId, contactId)).orderBy(desc(usageEvents.timestamp)).all()
    : query.orderBy(desc(usageEvents.timestamp)).all()
  return rows.map(toUsageEvent)
}

/**
 * Writes one turn's usage exactly as the adapter reported it.
 *
 * Nothing is recomputed here, and that is the point. Claude's figure comes from
 * the SDK's own price table and Codex's from src/main/adapters/pricing.ts; both
 * were settled in Phase 5 against real turns. Re-deriving either at this layer
 * would replace a measured number with a guess — and Phase 5 measured what
 * happens when you try: summing Claude's per-step assistant messages reads 80x
 * low, because that `usage` field is a running snapshot rather than a per-step
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
  routineId?: string | null
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
    // The routine id was always in hand at the call site (TurnOrigin carries
    // it) and simply discarded until Phase 20 needed per-routine budgets.
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
  // Budget caps (blueprint §13) are still not *enforced* anywhere. What hangs
  // off this seam since Phase 20 is the soft alert — see budget-alerts.ts,
  // which honours the rule this comment has always carried: a summary with
  // unpriced turns is a lower bound, so the alert says "at least $X" and no
  // floor ever stops anything. Wrapped because an alert must never fail the
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
