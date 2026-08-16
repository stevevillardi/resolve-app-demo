import { z } from 'zod'

/**
 * The normalized agent stream (blueprint §3). Both backends map their native
 * events into these shapes so the UI and the cost logic branch on capability
 * rather than on backend name.
 *
 * Zod rather than bare types because Phase 6 pushes these across the process
 * boundary — same reasoning as src/shared/domain.ts.
 */

// --- Usage ------------------------------------------------------------------

/**
 * Where the dollar figure came from. Claude's SDK bundles a price table and
 * returns `total_cost_usd`; Codex returns tokens only, so we compute it from
 * src/main/adapters/pricing.ts. Both are estimates, neither is billing.
 */
export const costSourceSchema = z.enum(['sdk', 'computed'])

/**
 * Mirrors usageEventSchema's fields so Phase 6 can write a UsageEvent row
 * straight from this, plus the three the table doesn't keep.
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
 * A superset of the renderer's MessageBubbleError['kind']
 * (src/renderer/src/types/message.ts), so Phase 6 maps these onto error
 * bubbles without a translation table.
 */
export const agentErrorKindSchema = z.enum([
  'rate_limit',
  'sandbox_denied',
  'network',
  'auth',
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

  /** A complete assistant message. Emitted by both, once the text is final. */
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
    detail: z.string().optional()
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

// --- Capabilities -----------------------------------------------------------

/**
 * Blueprint §3: "preserve the genuine divergence points rather than papering
 * over them."
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
  costSource: costSourceSchema
})

// --- Inferred types ---------------------------------------------------------

export type CostSource = z.infer<typeof costSourceSchema>
export type AgentUsage = z.infer<typeof agentUsageSchema>
export type AgentErrorKind = z.infer<typeof agentErrorKindSchema>
export type AgentEvent = z.infer<typeof agentEventSchema>
export type AgentCapabilities = z.infer<typeof agentCapabilitiesSchema>

/** Narrowing helper — `AgentEvent & { type: T }` reads badly at call sites. */
export type AgentEventOf<T extends AgentEvent['type']> = Extract<AgentEvent, { type: T }>
