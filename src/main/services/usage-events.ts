import { randomUUID } from 'crypto'
import { desc, eq } from 'drizzle-orm'
import { initDb } from '../db'
import { toUsageEvent } from '../db/mappers'
import { usageEvents } from '../db/schema'
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
export function recordUsage(contactId: string, source: UsageSource, usage: AgentUsage): UsageEvent {
  const event: UsageEvent = {
    id: randomUUID(),
    contactId,
    timestamp: Date.now(),
    source,
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

  return event
}
