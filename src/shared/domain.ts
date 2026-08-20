import { z } from 'zod'

/**
 * The app's data model, as Zod schemas — the single definition both
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
/**
 * What a persona may do on disk, in four postures.
 *
 * `ask_writes` sits between reading and writing: it reads as freely as
 * `read_only`, and every write is held for a human's approve or deny in the
 * thread rather than refused outright.
 *
 * That posture is the one deliberate exception to this app's rule that the
 * level, set once when the persona is made, *is* the approval — a rule that
 * exists because pausing a conversation for a permission dialog defeats the
 * point of setting a level at all. It earns the exception because the
 * all-or-nothing choice forces over-granting: somebody who wants read-only
 * except for the occasional approved write had nowhere to sit. Approval widens
 * *when* a write may happen, never *where* — anything `workspace_write` denies
 * is still denied.
 */
export const sandboxLevelSchema = z.enum([
  'read_only',
  'ask_writes',
  'workspace_write',
  'full_access'
])
export const githubScopeSchema = z.enum(['read_only', 'open_pr', 'full_access'])
export const messageRoleSchema = z.enum(['user', 'assistant'])
export const groupMessageTypeSchema = z.enum([
  'system_summary',
  'user_mention',
  'agent_reply',
  'routine_run',
  /**
   * A persona asking for somebody else's branch to be merged into its tree —
   * the one step of worktree isolation a human has to take, since a persona
   * cannot land another checkout's work in its own. `branch` carries what it
   * wants, `content` carries why.
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

/**
 * What a repo/contact governance mutation actually was. Repo/contact lifecycle only — credentials, settings, skills and
 * routine CRUD are a different, larger surface this table does not cover.
 */
export const auditActionSchema = z.enum([
  'contact_created',
  'contact_renamed',
  'contact_deleted',
  'contact_model_changed',
  'contact_isolation_changed',
  'contact_repo_trust_changed',
  'contact_persona_rebound',
  'contact_recreated',
  'contact_session_reset',
  'repo_cloned',
  'pull_request_opened',
  'branch_merged',
  'branch_committed',
  'branch_discarded',
  'worktree_created',
  'worktree_reconciled'
])

/**
 * What triggered an audit event. Not TurnOrigin: none of the actions above
 * are triggered by an inbound chat message or mention, and this app has no
 * user table to point `user` at — it means "a human at the keyboard", which
 * is every renderer-initiated call. `routine` carries the routine's id as
 * plain text, no FK, for the same reason usage_events.routineId isn't one: a
 * routine deleted next week must not take its audit trail with it.
 */
export const auditActorKindSchema = z.enum(['user', 'routine', 'system'])

// --- Entities ---------------------------------------------------------------

export const skillSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  content: z.string()
})

/**
 * Which theme the user chose, as opposed to which one is showing: 'system'
 * resolves against the OS at paint time. Lives in the shared layer because
 * main needs it too — the window's pre-paint background colour is derived
 * from it (see src/main/index.ts), and main cannot read renderer storage.
 */
export const themePreferenceSchema = z.enum(['system', 'light', 'dark'])
export type ThemePreference = z.infer<typeof themePreferenceSchema>

export const personaTemplateSchema = z.object({
  id: z.string(),
  name: z.string(),
  avatarColor: z.string(),
  /**
   * DiceBear bottts seed — which robot this persona wears. Distinct from
   * `avatarColor`, which is only its tint. Historically the persona id;
   * user-editable since the robot picker.
   */
  avatarSeed: z.string(),
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
   * A persona carries two governance axes, and neither is sufficient here: an
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
  /** Two independent axes: disk access and GitHub authority. */
  sandbox: sandboxLevelSchema,
  githubScope: githubScopeSchema
})

/**
 * Where a Contact's session runs: `shared` is the repository itself, `worktree`
 * a checkout of its own, `exclusive` the repository with the lock held against
 * everyone else.
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

/**
 * Whether a backend can hold a turn open while a human answers an approval.
 *
 * Claude can: `canUseTool` is an async callback the SDK awaits, so the ask is
 * just a promise that resolves when the user clicks. Codex cannot: `codex
 * exec` is one-shot — its JSONL stream has no approval-request event and no
 * channel to answer one, and `approval_policy` only reaches the CLI as
 * `--config`, which in exec mode has nobody to ask. Shared between the persona
 * editor (which hides the posture) and the service (which refuses it), so the
 * two cannot disagree about which backends get the option.
 */
export function askBeforeWritesSupported(backend: PersonaBackend): boolean {
  return backend === 'claude'
}

/** Null reads as `shared` — that is what every pre-0007 row means. */
export function isolationOf(isolation: Isolation | null): Isolation {
  return isolation ?? 'shared'
}

/**
 * What this Contact has been told it may take from the repository it is bound
 * to.
 *
 * A persona is sealed against its repository by default — repo instructions,
 * skills, hooks and MCP config reach a session only where this says they may.
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
  /**
   * The branch that worktree is on — and it outlives the worktree. A Contact
   * that stops being isolated keeps its branch, so its committed work stays
   * attributed to it in the Branches panel. See the column comment in
   * src/main/db/schema.ts.
   */
  branch: z.string().nullable(),
  /** Null reads as `shared` — that is what every pre-0007 row means. */
  isolation: isolationSchema.nullable(),
  /**
   * A model for this Contact alone. Null means "whatever the persona says",
   * which is the normal case — see the column comment in src/main/db/schema.ts.
   */
  model: z.string().nullable(),
  /**
   * The unread boundary: message rows after this are unread. Null reads as
   * "everything read" — defensive only, since 0016 backfills and creation
   * stamps; the safe direction, because the failure mode of the other reading
   * is a wall of stale badges nobody asked for.
   */
  lastReadAt: z.number().nullable(),
  /** Null reads as "nothing trusted" — every pre-0009 row, and every new one. */
  repoTrust: repoTrustSchema.nullable()
})

export const groupSchema = z.object({
  id: z.string(),
  repoPath: z.string(),
  /** Same contract as contactSchema.lastReadAt. */
  lastReadAt: z.number().nullable(),
  /**
   * A name the user gave this group, or null to derive one from `repoPath`.
   *
   * Nullable rather than always populated, so that clearing it *is* the reset —
   * see the column comment in db/schema.ts. Read it through `groupName()` below
   * rather than directly, so no caller has to remember the fallback.
   */
  name: z.string().nullable(),
  /** Kept out of the conversation list. Null is visible; see db/schema.ts. */
  hidden: z.boolean().nullable()
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
  /**
   * `system_summary` only. Durable entries are the repo's running decision log
   * and are injected into every later session on it; the rest are injected only
   * while they are among the most recent, and stay queryable after that.
   */
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
   * `branch_request` only: when the ask was answered — the branch
   * was merged or discarded by a click in the Branches panel. Absent while the
   * request is still open, which is what lets the group thread and Home tell a
   * standing ask from a settled one.
   */
  resolvedAt: z.number().optional()
})

/**
 * What one turn did to the working tree, stamped by git rather than claimed by
 * the model — the same rule recordOfWork() sets for summaries.
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
 * The persisted message, deliberately just these few fields: `status` and
 * `error` describe an in-flight turn rather than a stored fact, so they stay
 * renderer-local (src/renderer/src/types/message.ts) and no column is added for
 * them. `work` *is* a stored fact — what the turn changed on disk — and only
 * assistant rows whose turn changed something carry it.
 */
export const messageSchema = z.object({
  id: z.string(),
  contactId: z.string(),
  role: messageRoleSchema,
  content: z.string(),
  timestamp: z.number(),
  work: turnWorkSchema.optional(),
  /**
   * The backend session that answered this message. Absent on rows written
   * before migration 0018 and on turns that died before the backend named a
   * session — which the thread reads as "carry on from the row above", never as
   * a boundary. See the column comment in src/main/db/schema.ts.
   */
  sessionId: z.string().optional()
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
 * so the adapter layer's output can be persisted without dropping anything.
 * Anything the adapter reports and this table cannot hold is spend that goes
 * unattributable — a turn whose model went unrecorded cannot be priced, or even
 * blamed, after the fact.
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
   * The routine whose fire spent this, for routine-origin turns. Plain
   * attribution, not a FK — may name a routine that no longer exists.
   */
  routineId: z.string().optional(),
  timestamp: z.number(),
  source: usageSourceSchema,
  inputTokens: z.number(),
  outputTokens: z.number(),
  cachedInputTokens: z.number().optional(),
  cacheWriteInputTokens: z.number().optional(),
  reasoningOutputTokens: z.number().optional(),
  /** Null when no price is known — never 0, which reads as free. */
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
  sessionId: z.string().optional(),
  /**
   * The assistant message this turn produced, so a thread can put a cost beside
   * a reply rather than only in a total. A real foreign key, not a timestamp
   * correlation: two turns finishing in the same millisecond would otherwise
   * swap their costs, and nothing would say so.
   *
   * Absent on rows written before the column existed, on compaction's own
   * spend, and on a turn that was billable but produced no text — all three of
   * which are honestly "no reply to point at" rather than a missing link.
   */
  messageId: z.string().optional()
})

/**
 * One repo/contact governance action. Mirrors usage_events'
 * posture: `contactId` is null once the Contact it describes is deleted, and
 * `repoPath`/`personaTemplateId` are copied text that may outlive what they
 * name, so "what happened, and to what" stays answerable either way.
 */
export const auditEventSchema = z.object({
  id: z.string(),
  createdAt: z.number(),
  action: auditActionSchema,
  actorKind: auditActorKindSchema,
  /** Only set when actorKind is 'routine'. Not a FK — see the schema comment. */
  actorRoutineId: z.string().optional(),
  /** Null once the Contact this describes has been deleted. */
  contactId: z.string().nullable(),
  repoPath: z.string(),
  personaTemplateId: z.string().optional(),
  /** A precomputed human-readable line, written where the actor had full context. */
  summary: z.string(),
  /** Action-specific old/new values, e.g. old/new RepoTrust. */
  metadata: z.record(z.string(), z.unknown()).optional()
})

// --- Write shapes -----------------------------------------------------------
// Ids are minted in main with crypto.randomUUID(), never accepted from the
// renderer, so every create input omits `id`. Updates take a full entity
// minus nothing — the editors are whole-form saves, not partial patches.

export const skillDraftSchema = skillSchema.omit({ id: true })
// `avatarSeed` is optional on the draft: quick-create flows don't ask for a
// robot, and createPersonaTemplate defaults it to the minted id — the exact
// robot those personas rendered before the seed became a choice.
export const personaTemplateDraftSchema = personaTemplateSchema
  .omit({ id: true })
  .partial({ avatarSeed: true })
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
    // Not offered at bind time either: the persona's model is the default worth
    // starting from, and overriding it is a later, per-Contact decision made
    // with the thread in front of you.
    model: true,
    // Not offered at bind time at all. Trusting a repository's instructions or
    // its skills means reading what they say first, and the bind flow has not
    // shown them — approval lives in the thread header, where the text is on
    // screen next to the switch. A new Contact starts trusting nothing.
    repoTrust: true,
    // Read state is the app's bookkeeping, stamped at creation — a renderer
    // that could supply it could mark threads read it has never shown.
    lastReadAt: true
  })
  // Optional rather than nullable: an absent isolation means "decide for me",
  // and main picks from the persona's sandbox level. Null is only ever a stored
  // value, meaning a row written before the column existed.
  .extend({
    isolation: isolationSchema.optional(),
    /**
     * Same `.trim().min(1)` as `contacts.update`'s rename.
     *
     * Both ends of a contact's name say the same thing on purpose: a name of
     * nothing but spaces is refused where it is created as well as where it is
     * changed. The two disagreed while the name was derived rather than typed,
     * which made the difference unreachable rather than harmless — now that the
     * bind flow has a name field, the boundary has to mean the same thing on
     * both sides of it.
     */
    displayName: z.string().trim().min(1)
  })
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
 * left open across a fire save its stale copy back over what the fire recorded,
 * silently losing the run.
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

/**
 * A rollup of UsageEvents for display.
 *
 * Derived, never stored — events are logged per turn precisely so that
 * totals stay computed rather than maintained, and nothing here changes that.
 *
 * It lives in `shared` rather than in the renderer because the
 * rollup is also computed in SQL (`usage.summaries`) and crosses the IPC
 * boundary, so main and the renderer have to agree on the shape. The renderer
 * still builds these itself from raw events wherever it already has them — the
 * two paths are pinned to each other by test.
 */
export const usageSummarySchema = z.object({
  /**
   * The sum of every *priced* turn, or null when none of them were priced.
   *
   * Read it with `unpricedEvents` or not at all. On its own it is the answer to
   * a narrower question than it looks like — "what did the turns we can price
   * cost", not "what did this cost" — and the two diverge silently the moment a
   * persona runs on a model missing from CODEX_PRICES.
   *
   * Nullable rather than defaulted to 0, in SQL as well: `SUM(cost_usd)` over
   * rows that are all NULL returns NULL, which is the same answer for the same
   * reason, and is why the aggregate did not need a `COALESCE` bolted on.
   */
  totalCostUsd: z.number().nullable(),
  totalInputTokens: z.number(),
  totalOutputTokens: z.number(),
  /**
   * Absent, not zero, when no turn recorded any cached input.
   *
   * The distinction survives into SQL as `COUNT(cached_input_tokens) > 0`:
   * "this backend never told us" and "it told us nothing was cached" render
   * differently, and collapsing them would invent a fact about the backend.
   */
  totalCachedInputTokens: z.number().optional(),
  /**
   * How many turns carried `costUsd: null` and are therefore missing from
   * `totalCostUsd`. Non-zero means the total is a floor, not a figure — see
   * formatCostSummary, which is what should render it.
   */
  unpricedEvents: z.number(),
  /** How many turns *did* contribute. `0` with events present means all unpriced. */
  pricedEvents: z.number()
})

/**
 * One contact's rollup, as `usage.summaries` returns it.
 *
 * Keyed by Contact and nothing else, because that is the only grouping the two
 * callers need and the only one that stays correct when they add their own: a
 * group's figure is its members' summed, and a persona's is its contacts'.
 * Returning per-persona and per-repo rows as well would mean three groupings to
 * keep in step where one composes.
 *
 * Spend whose Contact has been deleted has no id to group under and is absent,
 * which is what `usageForContacts` did with it too — the dashboard's unscoped
 * totals are where orphaned spend stays visible (spend
 * outlives what spent it).
 */
export const contactUsageSummarySchema = usageSummarySchema.extend({
  contactId: z.string()
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
export type AuditAction = z.infer<typeof auditActionSchema>
export type AuditActorKind = z.infer<typeof auditActorKindSchema>

export type Skill = z.infer<typeof skillSchema>
export type PersonaTemplate = z.infer<typeof personaTemplateSchema>
export type Contact = z.infer<typeof contactSchema>
export type Group = z.infer<typeof groupSchema>
export type GroupMessage = z.infer<typeof groupMessageSchema>
export type PersistedMessage = z.infer<typeof messageSchema>
export type TurnWork = z.infer<typeof turnWorkSchema>
export type Routine = z.infer<typeof routineSchema>
export type UsageEvent = z.infer<typeof usageEventSchema>
export type AuditEvent = z.infer<typeof auditEventSchema>
export type UsageSummary = z.infer<typeof usageSummarySchema>
export type ContactUsageSummary = z.infer<typeof contactUsageSummarySchema>

export type SkillDraft = z.infer<typeof skillDraftSchema>
export type PersonaTemplateDraft = z.infer<typeof personaTemplateDraftSchema>
export type ContactDraft = z.infer<typeof contactDraftSchema>
export type GroupMessageDraft = z.infer<typeof groupMessageDraftSchema>
export type RoutineDraft = z.infer<typeof routineDraftSchema>
export type RoutineUpdate = z.infer<typeof routineUpdateSchema>
