import type { AgentUsage } from '../../shared/agent'

/**
 * What started a turn, and what it left behind.
 *
 * Every turn in the app runs through the same pipeline in `messaging.ts` — same
 * lock, same session resume, same `messages` rows. What differs is only the
 * bookkeeping around it: which Group row it leaves behind, which `source` its
 * spend is attributed to, and who wants to know when it finished.
 *
 * An optional `groupId` parameter whose truthiness toggles three unrelated
 * things cannot carry all of them. A routine fire is the combination that
 * breaks it: no inbound Group row, a `routine_run` posted on the way out, and
 * spend attributed `source: 'routine'` — which no second optional parameter
 * expresses readably. So the intent is named here rather than inferred.
 *
 * The discriminant is deliberately spelled the same as `usageSourceSchema`'s
 * values, so the usage stamp is `origin.kind` rather than a mapping table that
 * could drift out of agreement with the branch above it.
 *
 * This lives in its own module rather than in `messaging.ts` because
 * `compaction.ts` needs it too, and `messaging.ts` already imports
 * `summarizeTurn` — putting the type on either side would make that a cycle.
 */
export type TurnOrigin =
  /** A 1:1 message the user typed. */
  | { kind: 'message' }
  /**
   * An @mention from a Group thread. The group is *chosen* — the user was
   * looking at that thread — so it is carried here.
   */
  | { kind: 'mention'; groupId: string }
  /**
   * A scheduled or manually-triggered Routine fire. No groupId: a routine's
   * group is *derived*, since there is exactly one per repo and the routine
   * must post to that one. `startTurn` resolves it from the contact.
   */
  | { kind: 'routine'; routineId: string }

/**
 * How a turn ended.
 *
 * Handed to whoever started the turn once every durable write is done. Settles
 * exactly once and never rejects — see `StartedTurn.completed` in messaging.ts
 * for why that guarantee is load-bearing rather than a convenience.
 */
export interface TurnOutcome {
  runId: string
  /** Exactly what was persisted as the assistant row; '' when nothing was. */
  finalText: string
  /** The last `error` event's message, or an escaped exception's. Null on a clean turn. */
  error: string | null
  /** True when `cancelRun()` aborted it — a stop, not a failure. */
  aborted: boolean
  usage: AgentUsage | null
  /**
   * What the summariser made of the turn, or null when it wrote nothing —
   * an empty reply, a backend without structured output, a repo with no Group,
   * or a swallowed failure. Callers that need a sentence regardless must have
   * their own fallback; this one is best-effort by construction.
   */
  summary: TurnSummary | null
}

/** The compaction service's verdict on a turn, as it was written to the Group. */
export interface TurnSummary {
  id: string
  summary: string
  category: 'decision' | 'tradeoff' | 'routine'
  durable: boolean
}
