import { contextWindowFor } from '../../../shared/context-windows'
import {
  aggregateUsage,
  byContactId,
  combineUsage,
  summariesFor
} from '../../../shared/usage-summary'
import type { PersonaBackend, UsageEvent, UsageSummary } from '@/types'

/**
 * The rollup rules live in `src/shared/usage-summary.ts`.
 *
 * They moved there when `usage.summaries` gave them a second implementation in
 * SQL. The two have to agree, so the test that proves it runs in the main
 * project against a real database — and a main-process test may not import a
 * renderer module. It is the same reason the domain model is shared rather than
 * renderer-local: one definition, read from both sides.
 *
 * Re-exported so `@/lib/usage` stays the one place the renderer reads about
 * spend, and no call site had to learn where the arithmetic lives.
 */
export { aggregateUsage, byContactId, combineUsage, summariesFor }

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
 * `null` prints as `—` rather than `$0.00`: both backends yield a dollar figure
 * — Claude's from its SDK, Codex's computed from our own price table — so a
 * null is a model we have no price for, not a backend that cannot
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
  /**
   * What the newest request handed the model: input + cached + cache-write.
   *
   * The occupancy figure — how full the window is *now*. Approximate on both
   * backends, because a turn reports one usage total covering every model
   * request it made, and a tool-heavy turn makes several. See `contextFill`.
   */
  lastPromptTokens: number
  /**
   * Every input token this session has been billed for, added up.
   *
   * A different number from the one above, and the distinction is the whole
   * point of the forever-thread problem: the prompt stops growing when the
   * conversation does, while this keeps climbing for as long as you keep
   * talking, because each turn re-bills the history.
   */
  billedInputTokens: number
  /** How many recorded turns went into these figures. */
  turns: number
  /** The newest turn counted, so the panel can say how fresh this is. */
  at: number
  model: string | null
  /** Which arithmetic produced them, so the UI can say which — see below. */
  reading: 'last-turn' | 'session-sum'
}

/**
 * Two figures about this contact's session, read from what was billed.
 *
 * They are deliberately not one number: collapsing them into a single
 * `promptTokens` is wrong on Codex in a way that only shows once something
 * divides by it. Measured against the real backend: cumulative input
 * `12122 → 25610 → 39114`, so the stored deltas are `12122 / 13488 /
 * 13504`. The **sum** — 39,114 — is what the session has cost in input. The
 * newest **delta** — 13,504 — is roughly what the last request actually held.
 * Reporting the sum as "how large the prompt is" overstates by 3× after three
 * turns and grows without bound; as a bill it is exactly right. Two claims, so
 * two names.
 *
 * The backends record incompatible things, and that is why this branches:
 *
 * **Claude** re-sends the entire conversation every turn, so one row's input
 * *is* that turn's prompt, and the session's cost is the rows added up.
 *
 * **Codex** reports cumulatively across a thread and `recordUsage` stores the
 * delta (see `deltaFrom` and `usageBaseline` in adapters/codex.ts) — so one row
 * is that turn's increment, which approximates its prompt, and the sum is the
 * running total the backend itself reported.
 *
 * Scoped to `sessionId`, because both figures belong to a session: rows from a
 * session that has ended describe a conversation the backend has forgotten.
 * Returns null when there is no session yet — nothing is in context until a
 * turn has run, and rendering that as 0 would suggest an empty prompt rather
 * than no prompt at all.
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

  // The same sum means different things per backend — Claude's rows are each a
  // whole prompt, Codex's are increments — which is exactly what `reading` is
  // for. As a *bill* it is right either way, and that is what this is.
  const billedInputTokens = forSession.reduce((total, event) => total + promptOf(event), 0)

  return {
    lastPromptTokens: promptOf(newest),
    billedInputTokens,
    turns: forSession.length,
    at: newest.timestamp,
    model: newest.model ?? null,
    reading: backend === 'codex' ? 'session-sum' : 'last-turn'
  }
}

/** How full the window is, once both halves are known. */
export interface ContextFill {
  /** 0–1, clamped: a session may legitimately exceed a stale table's figure. */
  fraction: number
  window: number
  /** Whether the denominator was read off a vendor page or inferred. */
  windowSource: 'published' | 'inferred'
}

/** Above this the meter warns; above CONTEXT_FULL it says so plainly. */
export const CONTEXT_ELEVATED = 0.7
export const CONTEXT_FULL = 0.9

/**
 * The occupancy fraction, or null when this app cannot honestly compute one.
 *
 * Null whenever the model has no row in `context-windows.ts`, and null is a
 * supported answer all the way to the screen — the meter falls back to the bare
 * token count, which is what the app showed before the table existed. That
 * fallback is the reason the reversal is defensible: a percentage appears where
 * there is a denominator to divide by, and nowhere else.
 *
 * The numerator is approximate on **both** backends, which is why the meter
 * renders `≈`. A turn reports one usage figure covering every model request it
 * made, so a turn that ran ten tools reports their prompts added together and
 * this over-reads. It errs high, which is the safer direction for a gauge whose
 * remedy — starting a fresh session — costs the model's memory of the thread.
 *
 * Clamped at 1: the table can be stale, or a model can be served with a larger
 * window than the one published, and a meter reading 130% would look like a bug
 * rather than like the honest "at least full" it means.
 */
export function contextFill(tokens: ContextTokens): ContextFill | null {
  const window = contextWindowFor(tokens.model)
  if (!window) return null

  return {
    fraction: Math.min(1, tokens.lastPromptTokens / window.tokens),
    window: window.tokens,
    windowSource: window.source
  }
}

/**
 * Usage rows indexed by the reply they paid for.
 *
 * The thread already holds every usage event for the contact, so putting a cost
 * beside a turn needs no new query — only the link that migration 0020 added.
 * Rows with no `messageId` are simply absent from the map, which is the right
 * answer for all three kinds that have none: written before the column existed,
 * compaction's own `summary` spend, and a billable turn that produced no text.
 *
 * First row wins on a duplicate. One turn writes one usage row, so a collision
 * would mean something upstream is wrong; picking the first at least keeps the
 * rendering stable across refetches rather than flickering between two figures.
 */
export function usageByMessage(events: UsageEvent[]): Map<string, UsageEvent> {
  const byMessage = new Map<string, UsageEvent>()
  for (const event of events) {
    if (event.messageId && !byMessage.has(event.messageId)) byMessage.set(event.messageId, event)
  }
  return byMessage
}
