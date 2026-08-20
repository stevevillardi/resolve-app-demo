import { z } from 'zod'
import { costSourceSchema } from './domain'

/**
 * The normalized agent stream. Both backends map their native events into these
 * shapes so the UI and the cost logic branch on capability rather than on
 * backend name.
 *
 * Zod rather than bare types because these are pushed across the process
 * boundary — same reasoning as src/shared/domain.ts.
 */

// --- Usage ------------------------------------------------------------------

/**
 * Where the dollar figure came from. Claude's SDK bundles a price table and
 * returns `total_cost_usd`; Codex returns tokens only, so we compute it from
 * src/main/adapters/pricing.ts. Both are estimates, neither is billing.
 *
 * Re-exported from domain.ts, which owns it because UsageEvent persists it.
 */
export { costSourceSchema }

/**
 * Mirrors usageEventSchema's fields, so a turn's usage can be written to a
 * UsageEvent row straight from this. The mirroring is complete in both
 * directions on purpose: a field produced here with no column to land in is
 * spend the dashboard can never account for, and the omission is silent.
 */
export const agentUsageSchema = z.object({
  inputTokens: z.number(),
  outputTokens: z.number(),
  cachedInputTokens: z.number().optional(),
  /** Codex reports cache writes separately from cache reads; Claude too. */
  cacheWriteInputTokens: z.number().optional(),
  reasoningOutputTokens: z.number().optional(),
  /** Null when the model isn't in the price table — never 0, which reads as free. */
  costUsd: z.number().nullable(),
  costSource: costSourceSchema,
  /** The model that actually served the turn, not the one requested. */
  model: z.string().optional()
})

// --- Errors -----------------------------------------------------------------

/**
 * Kept in step with the renderer's MessageBubbleError['kind']
 * (src/renderer/src/types/message.ts) so one is assigned to the other directly,
 * with no translation table. **Adding a kind here means adding it there too.**
 *
 * The two unions are the same set, and it is worth keeping them that way rather
 * than trusting the narrower one to be enough: the kind most likely to be
 * missing is `unknown`, which is what classifyErrorMessage() returns by default
 * — so a divergence bites on the common path rather than an edge one.
 */
export const agentErrorKindSchema = z.enum([
  'rate_limit',
  'sandbox_denied',
  'network',
  'auth',
  /**
   * The backend no longer recognises the stored resume key — a model/backend
   * change or vendor-side expiry. Distinct from `auth` because the remedy is a
   * fresh session, not new credentials; messaging.ts self-heals it once.
   */
  'session',
  'unknown'
])

// --- Events -----------------------------------------------------------------

export const agentEventSchema = z.discriminatedUnion('type', [
  /** First event of a turn. Carries the resume key to persist on the Contact. */
  z.object({ type: z.literal('session_started'), sessionId: z.string() }),

  /**
   * An incremental slice of assistant text. Claude emits these; Codex does not
   * (see AgentCapabilities.streamsTextDeltas) — consumers must handle a stream
   * that only ever produces `text_message`.
   */
  z.object({ type: z.literal('text_delta'), text: z.string() }),

  /**
   * A complete assistant message, emitted by both backends once the text is
   * final.
   *
   * IMPORTANT — this OVERLAPS `text_delta`, it does not follow on from it.
   * Claude emits the deltas for a block and then the same block whole, so a
   * consumer that appends both renders every reply twice. Pick one per stream:
   * render `text_delta` while `streamsTextDeltas` is true and treat
   * `text_message` as a correction, or ignore deltas entirely and take only
   * whole messages. What gets *persisted* is neither — that is `done.finalText`,
   * which is the backend's own authoritative final answer.
   */
  z.object({ type: z.literal('text_message'), text: z.string() }),

  /** Reasoning summary, where the backend exposes one. */
  z.object({ type: z.literal('reasoning'), text: z.string() }),

  z.object({
    type: z.literal('tool_start'),
    toolCallId: z.string(),
    name: z.string(),
    /** Human-readable specifics — the command line, the file path. */
    detail: z.string().optional()
  }),

  /**
   * Progress *during* execution. Codex emits these for running commands; for
   * Claude it depends on the SDK's tool_progress heartbeat.
   */
  z.object({
    type: z.literal('tool_progress'),
    toolCallId: z.string(),
    name: z.string(),
    elapsedMs: z.number().optional(),
    output: z.string().optional()
  }),

  z.object({
    type: z.literal('tool_end'),
    toolCallId: z.string(),
    name: z.string(),
    status: z.enum(['completed', 'failed']),
    detail: z.string().optional(),
    /**
     * How the call answered — stdout tail, MCP result text, or the error a
     * failed call reported. Bounded by the adapter to TOOL_OUTPUT_MAX before
     * it is emitted, so neither the push channel nor the tool_calls row ever
     * carries an unbounded blob.
     */
    output: z.string().optional()
  }),

  /**
   * A turn-level failure. Not necessarily terminal on its own — Codex surfaces
   * non-fatal problems as error items too — but `done` always follows.
   */
  z.object({
    type: z.literal('error'),
    kind: agentErrorKindSchema,
    message: z.string()
  }),

  /** Always the last event, including after an error. */
  z.object({
    type: z.literal('done'),
    finalText: z.string(),
    usage: agentUsageSchema.nullable()
  })
])

/**
 * The one place the excerpt bounds live. `detail` is what a call was asked;
 * `output` is how it answered. Adapters bound at emit time, messaging persists
 * what was emitted, and the renderer can rely on both without re-clamping.
 */
export const TOOL_DETAIL_MAX = 500
export const TOOL_OUTPUT_MAX = 4000

/** Clamps with an explicit marker, so a cut excerpt never reads as complete. */
export function toolExcerpt(text: string, max: number): string {
  if (text.length <= max) return text
  return `${text.slice(0, max)}\n… [truncated]`
}

// --- The push channel -------------------------------------------------------

/**
 * What main pushes to the renderer while a turn runs.
 *
 * The rest of the bridge is request/response only, so this is the one channel
 * that travels main→renderer unprompted. It follows the same shape as
 * `ipc-invoke`: ONE channel, with the payload saying what it is, rather than a
 * channel per run — which keeps the preload surface fixed and avoids listener
 * churn as runs come and go.
 *
 * Keyed by `runId`, not by session id: `AgentSession.sessionId` is null until
 * the adapter fills it in mid-stream at `session_started`, so a contact's first
 * turn would have nothing to subscribe to. Main mints the runId up front and
 * hands it back from `messages.send`.
 */
export const AGENT_EVENT_CHANNEL = 'agent-event'

export const agentStreamMessageSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('event'), runId: z.string(), event: agentEventSchema }),
  /**
   * The set of in-flight runs changed. Carries no payload — the renderer
   * refetches `runs.list`, so there is one authority on what is running rather
   * than a cache the renderer maintains by replaying deltas.
   */
  z.object({ kind: z.literal('runs-changed') }),
  /**
   * A `usage_events` row was written, so `usage.list` is stale. No payload,
   * for the same reason as `runs-changed`.
   *
   * Distinct from `done` because not every turn has a renderer watching it.
   * `done` only reaches a component subscribed to that specific `runId`, which
   * a scheduled routine has none of — and a summary turn records its usage
   * from compaction, *after* the run it belongs to is already over. Emitted
   * from recordUsage itself so all four sources announce spend by one path.
   */
  z.object({ kind: z.literal('usage-changed') }),
  /**
   * A routine's durable state changed — run history, a recorded miss, a
   * schedule re-arm. Announced rather than left to incidental refetch, because
   * a 3 a.m. fire has no window watching it and its row would otherwise stay
   * stale until the next focus.
   */
  z.object({ kind: z.literal('routines-changed') }),
  /**
   * A message row was written somewhere — 1:1 or group, whatever wrote it.
   * Exists because a background run (a routine, a turn on a closed thread) has
   * no renderer subscribed to its runId, so previews and unread counts had no
   * signal at all for exactly the messages that arrive while nobody watches.
   */
  z.object({ kind: z.literal('messages-changed') }),
  /**
   * An `audit_events` row was written, so `audit.list` is stale. No payload,
   * for the same reason as `usage-changed` — emitted from recordAuditEvent
   * itself so every one of its 16 call sites announces by one path.
   */
  z.object({ kind: z.literal('audit-changed') })
])

// --- Capabilities -----------------------------------------------------------

/**
 * Where the two backends genuinely differ, preserved rather than papered over.
 *
 * The two backends diverge in both directions, which is why this is a set of
 * flags and not a "richness" ranking: Claude streams token-level deltas but
 * historically went quiet during tool execution, while Codex ships each
 * message whole but reports live command status while it runs.
 */
export const agentCapabilitiesSchema = z.object({
  /** Whether `text_delta` is ever emitted, or only whole `text_message`s. */
  streamsTextDeltas: z.boolean(),
  /** Whether `tool_progress` is emitted between tool_start and tool_end. */
  streamsToolProgress: z.boolean(),
  costSource: costSourceSchema,
  /**
   * How a persona's `sandbox` level is actually enforced for this backend.
   *
   * `os` — the operating system confines the agent's commands, and no command
   * line can talk its way out. `policy` — only our in-process allowlist
   * (src/main/adapters/sandbox.ts) stands in the way, which is a real guard but
   * a weaker one. The UI should say which the user is getting rather than
   * showing the same "read-only" chip for both.
   */
  sandboxEnforcement: z.enum(['os', 'policy']),
  /**
   * Whether `AgentAdapter.summarize()` can actually constrain output to a
   * schema on this backend.
   *
   * Both do today, by different mechanisms (Claude's session-level
   * `outputFormat`, Codex's per-turn `outputSchema`). The flag exists so
   * end-of-session compaction can degrade honestly on a backend that stops
   * supporting it, rather than silently writing unparseable summaries into the
   * Group — the same reason `sandboxEnforcement` is reported rather than
   * assumed.
   */
  supportsStructuredOutput: z.boolean()
})

// --- Inferred types ---------------------------------------------------------

export type { CostSource } from './domain'
export type AgentUsage = z.infer<typeof agentUsageSchema>
export type AgentErrorKind = z.infer<typeof agentErrorKindSchema>
export type AgentEvent = z.infer<typeof agentEventSchema>
export type AgentCapabilities = z.infer<typeof agentCapabilitiesSchema>
export type AgentStreamMessage = z.infer<typeof agentStreamMessageSchema>

/** Narrowing helper — `AgentEvent & { type: T }` reads badly at call sites. */
export type AgentEventOf<T extends AgentEvent['type']> = Extract<AgentEvent, { type: T }>
