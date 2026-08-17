import { z } from 'zod'

/**
 * The blueprint §4 data model, as Zod schemas — the single definition both
 * processes compile against. Main persists these shapes (src/main/db/schema.ts
 * mirrors them column-for-column), the IPC contract validates them at the
 * boundary, and the renderer re-exports the inferred types from `@/types`.
 *
 * Timestamps are epoch milliseconds on the wire. SQLite stores them as
 * integers and Drizzle hands back `Date`, so src/main/db/mappers.ts converts
 * at the service edge — nothing outside main ever sees a Date.
 */

// --- Enumerations -----------------------------------------------------------

export const personaBackendSchema = z.enum(['claude', 'codex'])
export const sandboxLevelSchema = z.enum(['read_only', 'workspace_write', 'full_access'])
export const githubScopeSchema = z.enum(['read_only', 'open_pr', 'full_access'])
export const messageRoleSchema = z.enum(['user', 'assistant'])
export const groupMessageTypeSchema = z.enum([
  'system_summary',
  'user_mention',
  'agent_reply',
  'routine_run',
  /**
   * A persona asking for somebody else's branch to be merged into its tree —
   * the one step of docs/plan/12-worktree-isolation.md that a human has to
   * take. `branch` carries what it wants, `content` carries why.
   */
  'branch_request'
])
export const systemSummaryCategorySchema = z.enum(['decision', 'tradeoff', 'routine'])
export const usageSourceSchema = z.enum(['message', 'routine', 'mention', 'summary'])
/**
 * Where a dollar figure came from: the backend returned it, or we computed it
 * from src/main/adapters/pricing.ts. Defined here rather than in agent.ts
 * because it is persisted on a UsageEvent, and agent.ts re-exports it.
 */
export const costSourceSchema = z.enum(['sdk', 'computed'])

// --- Entities ---------------------------------------------------------------

export const skillSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  content: z.string()
})

export const personaTemplateSchema = z.object({
  id: z.string(),
  name: z.string(),
  avatarColor: z.string(),
  backend: personaBackendSchema,
  /**
   * Null means the backend's own default. Free text, not an enum — model
   * availability is decided per account by the vendor, so the set of valid
   * values is not knowable here (see src/main/db/schema.ts).
   */
  model: z.string().nullable(),
  systemPrompt: z.string(),
  skillIds: z.array(z.string()),
  /**
   * The MCP servers this persona may use, by id — an allowlist over the app's
   * own curated registry, never arbitrary URLs.
   *
   * Blueprint §4 names two governance axes and stops being sufficient here: an
   * MCP server is *network reach*, which neither `sandbox` (disk) nor
   * `githubScope` (GitHub authority) describes. Rather than invent a third enum
   * with one meaningful value in it, this allowlist **is** the axis in its v1
   * form — the registry is closed and its only entry is GitHub, whose reach is
   * exactly what `githubScope` already governs. A named `network` axis becomes
   * necessary the day arbitrary servers can be added, and not before.
   *
   * A JSON array for the same reasons as `skillIds`: no relational queries, and
   * the order the user picked is worth keeping.
   */
  mcpServerIds: z.array(z.string()),
  /** Two independent axes (blueprint §4): disk access and GitHub authority. */
  sandbox: sandboxLevelSchema,
  githubScope: githubScopeSchema
})

/**
 * Where a Contact's session runs (docs/plan/12-worktree-isolation.md §4).
 *
 * Chosen per Contact rather than per persona, because the same persona may want
 * isolation on one repo and not on another. This picks the *location*; the lock
 * mode still comes from the persona's sandbox level — except for `exclusive`,
 * which is the escape hatch that locks the main tree even for a reader.
 */
export const isolationSchema = z.enum(['shared', 'worktree', 'exclusive'])

/**
 * What a new Contact gets when nobody says otherwise.
 *
 * Lives here rather than in main because the bind flow has to show the same
 * answer the service would have chosen — two copies of this rule would drift
 * into a picker that pre-selects one thing and a database that stores another.
 *
 * Readers stay in the main tree: they are never refused by the run lock anyway,
 * and the main tree is the only place uncommitted work is visible, which is
 * usually the thing a reviewer was asked to look at. Writers are the ones that
 * contend, so writers are the ones that get isolated.
 */
export function defaultIsolation(sandbox: SandboxLevel): Isolation {
  return sandbox === 'read_only' ? 'shared' : 'worktree'
}

/** Null reads as `shared` — that is what every pre-0007 row means. */
export function isolationOf(isolation: Isolation | null): Isolation {
  return isolation ?? 'shared'
}

/**
 * What this Contact has been told it may take from the repository it is bound
 * to (docs/plan/14-agent-capability-surface.md §3).
 *
 * Per Contact rather than per persona, for the same reason `isolation` is: the
 * same persona may trust one repository and not another. And it is a trust
 * question rather than a preference — `CLAUDE.md`, `AGENTS.md` and a `SKILL.md`
 * are instructions written by whoever owns the repo, which is a different thing
 * from the persona's own system prompt. A persona bound to a repo cloned from a
 * colleague would otherwise start taking direction from it silently.
 *
 * `skills` is an allowlist of names rather than a boolean on purpose: a skill
 * committed to the repository *after* the human approved what was there must
 * not inherit that approval.
 */
export const repoTrustSchema = z.object({
  /** Whether the repo's own CLAUDE.md / AGENTS.md reaches the model. */
  instructions: z.boolean(),
  /** Repo skill names this Contact may use. Everything else stays disabled. */
  skills: z.array(z.string())
})

/** Null means nothing is trusted, which is where every Contact starts. */
export function repoTrustOf(trust: RepoTrust | null): RepoTrust {
  return trust ?? { instructions: false, skills: [] }
}

export const contactSchema = z.object({
  id: z.string(),
  personaTemplateId: z.string(),
  /** The canonical repo, whatever directory the session actually runs in. */
  repoPath: z.string(),
  displayName: z.string(),
  /** Resume key for the backend session; null until the first turn runs. */
  backendSessionId: z.string().nullable(),
  /**
   * Where this Contact works; null means the repo itself.
   *
   * Set when the Contact is created and before the directory exists — see the
   * column comment in src/main/db/schema.ts for why the path is planned up
   * front rather than at first use.
   */
  worktreePath: z.string().nullable(),
  /** The branch that worktree is on. Null whenever worktreePath is. */
  branch: z.string().nullable(),
  /** Null reads as `shared` — that is what every pre-0007 row means. */
  isolation: isolationSchema.nullable(),
  /** Null reads as "nothing trusted" — every pre-0009 row, and every new one. */
  repoTrust: repoTrustSchema.nullable()
})

export const groupSchema = z.object({
  id: z.string(),
  repoPath: z.string()
})

export const groupMessageSchema = z.object({
  id: z.string(),
  groupId: z.string(),
  timestamp: z.number(),
  type: groupMessageTypeSchema,
  /** Absent on `user_mention` — that one comes from the user, not a contact. */
  contactId: z.string().optional(),
  content: z.string(),
  /** `system_summary` only. */
  category: systemSummaryCategorySchema.optional(),
  /** `system_summary` only — durable entries are always re-injected (§6). */
  durable: z.boolean().optional(),
  /**
   * The branch this row is about.
   *
   * On a summary it is where the work landed, which is how a writer's otherwise
   * invisible branch becomes known to every later session on the repo — these
   * rows are already injected into each one. On a `branch_request` it is the
   * branch being asked for instead.
   *
   * Still absent whenever a Contact works in the main tree, which is the common
   * case for readers: there is no branch worth naming when the changes are
   * simply on disk.
   */
  branch: z.string().optional(),
  /**
   * `branch_request` only (Phase 19): when the ask was answered — the branch
   * was merged or discarded by a click in the Branches panel. Absent while the
   * request is still open, which is what lets the group thread and Home tell a
   * standing ask from a settled one.
   */
  resolvedAt: z.number().optional()
})

/**
 * What one turn did to the working tree, stamped by git rather than claimed by
 * the model (Phase 19) — the same rule recordOfWork() set for summaries.
 *
 * `committed` is head-before → head-after; `dirty` is only what the turn *newly*
 * left uncommitted (paths already dirty before it are not attributed to it — a
 * turn that edits an already-dirty file goes unchipped, which is stated here
 * rather than hidden). Both empty means the record is not written at all.
 */
export const turnWorkSchema = z.object({
  branch: z.string().nullable(),
  headBefore: z.string().nullable(),
  headAfter: z.string().nullable(),
  committed: z.array(z.string()),
  dirty: z.array(z.string())
})

/**
 * The persisted message. Blueprint §12 is deliberately just these five fields:
 * `status` and `error` describe an in-flight turn rather than a stored fact,
 * so they stay renderer-local (src/renderer/src/types/message.ts) and no
 * column is added for them. `work` (Phase 19) *is* a stored fact — what the
 * turn changed on disk — and only assistant rows whose turn changed something
 * carry it.
 */
export const messageSchema = z.object({
  id: z.string(),
  contactId: z.string(),
  role: messageRoleSchema,
  content: z.string(),
  timestamp: z.number(),
  work: turnWorkSchema.optional()
})

export const routineSchema = z.object({
  id: z.string(),
  contactId: z.string(),
  /** Cron expression. Validated where it's edited, not here. */
  schedule: z.string(),
  prompt: z.string(),
  enabled: z.boolean(),
  lastRunAt: z.number().nullable(),
  lastRunSummary: z.string().nullable(),
  /** Scheduled fires that never ran (machine asleep). Cleared by any attempt. */
  missedRunCount: z.number(),
  lastMissedAt: z.number().nullable(),
  /**
   * Soft monthly spend threshold in USD; null = no budget. Editable, so unlike
   * the run history above it is deliberately NOT omitted from the write shapes.
   */
  monthlyBudgetUsd: z.number().nullable()
})

/**
 * One row per turn. Mirrors AgentUsage (src/shared/agent.ts) field for field,
 * so the adapter layer's output can be persisted without dropping anything —
 * it used to keep only tokens and cost, which left the model that served the
 * turn unrecorded and its spend unattributable.
 */
export const usageEventSchema = z.object({
  id: z.string(),
  /**
   * Null once the Contact that spent this has been deleted. The spend itself is
   * never deleted — see the column comment in db/schema.ts.
   */
  contactId: z.string().nullable(),
  /**
   * Copied off the Contact when the row is written, so the two questions the
   * dashboard actually asks — whose spend, and on which repo — survive that
   * Contact being deleted. Absent only on rows written before migration 0008,
   * which backfilled every one it could reach.
   */
  personaTemplateId: z.string().optional(),
  repoPath: z.string().optional(),
  /**
   * The routine whose fire spent this, for routine-origin turns (Phase 20).
   * Plain attribution, not a FK — may name a routine that no longer exists.
   */
  routineId: z.string().optional(),
  timestamp: z.number(),
  source: usageSourceSchema,
  inputTokens: z.number(),
  outputTokens: z.number(),
  cachedInputTokens: z.number().optional(),
  cacheWriteInputTokens: z.number().optional(),
  reasoningOutputTokens: z.number().optional(),
  /** Null when no price is known — never 0, which reads as free (§3). */
  costUsd: z.number().nullable(),
  /** Recorded per event: a persona's model can change, its history can't. */
  model: z.string().optional(),
  /** Whether costUsd came from the backend or from our own price table. */
  costSource: costSourceSchema.optional(),
  /**
   * The backend session this turn belonged to. Absent on rows written before
   * the column existed, and on turns no session id was reported for. Used to
   * subtract Codex's cumulative token reading back down to one turn — see the
   * column comment in db/schema.ts.
   */
  sessionId: z.string().optional()
})

// --- Write shapes -----------------------------------------------------------
// Ids are minted in main with crypto.randomUUID(), never accepted from the
// renderer, so every create input omits `id`. Updates take a full entity
// minus nothing — the editors are whole-form saves, not partial patches.

export const skillDraftSchema = skillSchema.omit({ id: true })
export const personaTemplateDraftSchema = personaTemplateSchema.omit({ id: true })
/**
 * `worktreePath` and `branch` are omitted alongside the ids because main derives
 * them from the repo and persona — a renderer-supplied working path would be a
 * way to point a session at any directory on disk, which is the one thing the
 * sandbox levels exist to prevent. `isolation` stays, because it is the choice
 * the bind flow actually asks the user to make.
 */
export const contactDraftSchema = contactSchema
  .omit({
    id: true,
    backendSessionId: true,
    worktreePath: true,
    branch: true,
    isolation: true,
    // Not offered at bind time at all. Trusting a repository's instructions or
    // its skills means reading what they say first, and the bind flow has not
    // shown them — approval lives in the thread header, where the text is on
    // screen next to the switch. A new Contact starts trusting nothing.
    repoTrust: true
  })
  // Optional rather than nullable: an absent isolation means "decide for me",
  // and main picks from the persona's sandbox level. Null is only ever a stored
  // value, meaning a row written before the column existed.
  .extend({ isolation: isolationSchema.optional() })
/**
 * `timestamp` is omitted alongside `id` because main mints it too — a
 * renderer-supplied time would let a clock skew reorder the thread.
 */
/**
 * `resolvedAt` is omitted along with the minted fields: a request is never
 * born answered — resolution is stamped by the merge/discard that answers it
 * (resolveBranchRequests), not accepted from a writer.
 */
export const groupMessageDraftSchema = groupMessageSchema.omit({
  id: true,
  timestamp: true,
  resolvedAt: true
})
/**
 * `lastRunAt`/`lastRunSummary` are omitted from *both* write shapes, not just
 * the create one, because they are run history — written by the scheduler and
 * by nothing else. Taking a whole `routineSchema` on update would let an editor
 * that had been open across a fire save its stale copy back over what the fire
 * recorded, silently losing the run.
 */
export const routineDraftSchema = routineSchema.omit({
  id: true,
  lastRunAt: true,
  lastRunSummary: true,
  missedRunCount: true,
  lastMissedAt: true
})
export const routineUpdateSchema = routineSchema.omit({
  lastRunAt: true,
  lastRunSummary: true,
  missedRunCount: true,
  lastMissedAt: true
})

// --- Inferred types ---------------------------------------------------------

export type PersonaBackend = z.infer<typeof personaBackendSchema>
export type SandboxLevel = z.infer<typeof sandboxLevelSchema>
export type GithubScope = z.infer<typeof githubScopeSchema>
export type MessageRole = z.infer<typeof messageRoleSchema>
export type GroupMessageType = z.infer<typeof groupMessageTypeSchema>
export type SystemSummaryCategory = z.infer<typeof systemSummaryCategorySchema>
export type UsageSource = z.infer<typeof usageSourceSchema>
export type CostSource = z.infer<typeof costSourceSchema>
export type Isolation = z.infer<typeof isolationSchema>
export type RepoTrust = z.infer<typeof repoTrustSchema>

export type Skill = z.infer<typeof skillSchema>
export type PersonaTemplate = z.infer<typeof personaTemplateSchema>
export type Contact = z.infer<typeof contactSchema>
export type Group = z.infer<typeof groupSchema>
export type GroupMessage = z.infer<typeof groupMessageSchema>
export type PersistedMessage = z.infer<typeof messageSchema>
export type TurnWork = z.infer<typeof turnWorkSchema>
export type Routine = z.infer<typeof routineSchema>
export type UsageEvent = z.infer<typeof usageEventSchema>

export type SkillDraft = z.infer<typeof skillDraftSchema>
export type PersonaTemplateDraft = z.infer<typeof personaTemplateDraftSchema>
export type ContactDraft = z.infer<typeof contactDraftSchema>
export type GroupMessageDraft = z.infer<typeof groupMessageDraftSchema>
export type RoutineDraft = z.infer<typeof routineDraftSchema>
export type RoutineUpdate = z.infer<typeof routineUpdateSchema>
