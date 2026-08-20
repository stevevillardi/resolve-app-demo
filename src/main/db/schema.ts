import { sqliteTable, integer, real, text, index, uniqueIndex } from 'drizzle-orm/sqlite-core'
import type { RepoTrust, TurnWork } from '../../shared/domain'

/**
 * One table per entity in the data model. The column shapes mirror the Zod
 * schemas in src/shared/domain.ts — that file is the contract, this one is how
 * it lands on disk, and src/main/db/mappers.ts converts between them.
 *
 * Foreign keys here are only real because initDb() turns on
 * `PRAGMA foreign_keys` — better-sqlite3 leaves it off by default, which would
 * make every reference below decorative.
 */

/**
 * App-level key/value state. Permanent, unlike the `_bootstrap_check` table
 * this migration drops.
 *
 * Non-secret metadata ONLY. Tokens and API keys live in the OS keychain via
 * src/main/services/secrets.ts and must never be written here, so that
 * inspecting the .db file is a sufficient check that nothing leaked.
 *
 * Known keys are enumerated in services/app-state.ts.
 */
export const appState = sqliteTable('app_state', {
  key: text('key').primaryKey(),
  value: text('value').notNull()
})

export const skills = sqliteTable('skills', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull(),
  content: text('content').notNull()
})

export const personaTemplates = sqliteTable('persona_templates', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  avatarColor: text('avatar_color').notNull(),
  /**
   * DiceBear bottts seed — which robot. Nullable rather than `notNull` so the
   * migration needs no backfill: null reads as "seed = this row's id", which
   * is exactly the robot every persona rendered before the column existed
   * (coalesced in toPersonaTemplate). Same posture as `mcpServerIds` below.
   */
  avatarSeed: text('avatar_seed'),
  backend: text('backend', { enum: ['claude', 'codex'] }).notNull(),
  /**
   * Null means "whatever this backend defaults to", which is what every
   * persona created before this column existed gets — so no backfill.
   *
   * Free text rather than an enum: which models an account may actually use is
   * decided by the vendor at request time, not by us. A ChatGPT-plan Codex
   * account rejects model names the CLI itself knows about (see
   * DEFAULT_CODEX_MODEL), so an enum here would encode one account's
   * entitlements as everyone's schema.
   */
  model: text('model'),
  systemPrompt: text('system_prompt').notNull(),
  /**
   * An ordered JSON array rather than a join table. Skills are injected text
   * with no relational queries over them, and the order they are injected in
   * is the persona's — a join table would lose that order, or need a position
   * column to fake it back.
   */
  skillIds: text('skill_ids', { mode: 'json' }).$type<string[]>().notNull(),
  /**
   * MCP server ids from the app's own curated registry — never arbitrary URLs.
   * Same JSON-array treatment as `skillIds` above, and for the same reasons.
   *
   * Nullable rather than `notNull` so migration 0009 needs no backfill: a row
   * without it reads as "no servers", which is what every persona created
   * before this column meant and what a persona should default to anyway.
   */
  mcpServerIds: text('mcp_server_ids', { mode: 'json' }).$type<string[]>(),
  sandbox: text('sandbox', { enum: ['read_only', 'workspace_write', 'full_access'] }).notNull(),
  githubScope: text('github_scope', {
    enum: ['read_only', 'open_pr', 'full_access']
  }).notNull()
})

export const contacts = sqliteTable(
  'contacts',
  {
    id: text('id').primaryKey(),
    // restrict, not cascade: deleting a persona that contacts are bound to
    // would silently take their whole message history with it.
    personaTemplateId: text('persona_template_id')
      .notNull()
      .references(() => personaTemplates.id, { onDelete: 'restrict' }),
    /**
     * The canonical repo. Keeps that meaning even once the session runs
     * somewhere else, so the one-Group-per-repository rule and the
     * groups_repo_path_unique index below are untouched by worktrees.
     */
    repoPath: text('repo_path').notNull(),
    displayName: text('display_name').notNull(),
    backendSessionId: text('backend_session_id'),
    /**
     * Where this Contact actually works; null means the repo itself.
     *
     * Written when the Contact is created, before the directory exists — the
     * path is derived deterministically and the worktree is only materialised
     * on the first writing turn. startTurn() is synchronous and has to know the
     * lock key before it can acquire, so it cannot wait on a `git worktree add`;
     * storing the planned path up front keeps workingPathFor() pure and the lock
     * key stable from the very first turn.
     */
    worktreePath: text('worktree_path'),
    /**
     * The branch its worktree is on.
     *
     * Outlives `worktree_path`: de-isolating a Contact removes the checkout
     * and keeps the branch, because `git worktree remove` leaves the commits
     * and the Branches panel attributes a branch to a Contact by matching this
     * column. Nulling it would turn that Contact's own committed work into an
     * orphan branch with no owner. Every reader gates on `worktree_path` or on
     * `isolationOf(...) === 'worktree'` first, so a branch with no checkout is
     * inert until the Contact is isolated again — at which point it is
     * deliberately the same branch.
     */
    branch: text('branch'),
    /**
     * Where the session runs, chosen per Contact at bind time — the same
     * persona may want isolation on one repo and not another.
     *
     * Null reads as `shared`, which is what every row written before this column
     * existed means. Note this decides *where* the session runs, not whether it
     * locks: the lock mode still comes from the persona's sandbox level, except
     * for `exclusive`, which forces a lock even on a reader.
     *
     * As with usage_events.source below, the enum is a Drizzle/Zod assertion
     * rather than a DB CHECK, so a fourth mode later needs no migration.
     */
    isolation: text('isolation', { enum: ['shared', 'worktree', 'exclusive'] }),
    /**
     * A model just for this Contact, overriding its persona's.
     *
     * Null means "whatever the persona says", which is every row written before
     * this column and most rows after it. The persona is still where a model is
     * normally chosen; this exists because a persona is reusable across
     * repositories and a model choice often is not — the same reviewer may be
     * worth an expensive model on the codebase that pays for it and a cheap one
     * everywhere else, and editing the persona to say so changes it for every
     * Contact bound to it.
     *
     * Not validated against the backend here. `models.ts` is a menu of
     * plausible choices rather than a promise (availability depends on the
     * account), so an unavailable model surfaces as a 400 in the thread like
     * any other backend error, and a CHECK constraint would only turn a
     * legible failure into an illegible one.
     */
    model: text('model'),
    /**
     * What this Contact may take from the repository it is bound to:
     * `{ instructions: boolean, skills: string[] }`.
     *
     * Null means nothing is trusted, so every row written before this column —
     * and every row written after it — starts sealed. That is the safe
     * direction for a default, which is why the column carries no NOT NULL and
     * no server default: an absent value can only ever mean less access.
     *
     * JSON rather than two columns because the pair is written and read
     * together, always through repoTrustOf() in shared/domain.ts, and because
     * a third kind of trust would otherwise be another migration.
     */
    repoTrust: text('repo_trust', { mode: 'json' }).$type<RepoTrust>(),
    /**
     * When this thread was last on screen. The unread boundary: rows after it
     * count, rows at or before it are read. Migration 0016 backfills existing
     * rows to its own run time — an upgrade must land with zero badges, not a
     * wall of stale ones — and creation stamps new rows, so null is defensive
     * only and reads as "everything read".
     */
    lastReadAt: integer('last_read_at', { mode: 'timestamp_ms' })
  },
  (table) => [
    index('contacts_repo_path_idx').on(table.repoPath),
    /**
     * "Which contacts use this persona" (Phase 25 §B4).
     *
     * Read by the persona detail panel's bound-contacts list, by the usage
     * rail's per-persona rollup, and — the one that matters — by the RESTRICT
     * gate that refuses to delete a persona still in use. All three were full
     * table scans on a column that is a foreign key.
     */
    index('contacts_persona_template_idx').on(table.personaTemplateId)
  ]
)

export const groups = sqliteTable(
  'groups',
  {
    id: text('id').primaryKey(),
    repoPath: text('repo_path').notNull(),
    /** Same contract as contacts.lastReadAt — see that comment. */
    lastReadAt: integer('last_read_at', { mode: 'timestamp_ms' }),
    /**
     * A name the user gave this group, overriding the repository's own.
     *
     * Null is not "unnamed" — it means *derive from `repo_path`*, which is what
     * every group displayed before this column and what a group still displays
     * until someone decides otherwise. Storing the derived name at creation
     * instead would have frozen it: a repository moved on disk would keep the
     * old folder's name forever, with nothing on screen to explain why.
     *
     * That also makes rename reversible without a second control — clearing the
     * field is a real operation with an obvious meaning, so `groups.rename`
     * takes `string | null` rather than needing a "reset to default" action
     * beside it.
     */
    name: text('name'),
    /**
     * Whether this group is kept out of the conversation list.
     *
     * Groups are created implicitly — `ensureGroupForRepo` runs inside
     * `createContact`, so binding a second persona to a repository silently
     * produces a row in the sidebar. Hiding is the answer to that rather than
     * deletion: a group cannot be deleted, because the thing it is a view *of*
     * is the set of contacts on a repository, and that set is still there.
     *
     * Nullable with null meaning visible, matching `last_read_at`'s posture in
     * this table: absence is a meaning, and an upgraded profile needs no
     * backfill to keep behaving exactly as it did. Hiding hides the row and
     * nothing else — the group's messages, spend and unread counts are all
     * still recorded, so unhiding restores a complete thread rather than one
     * that starts from the moment it came back.
     */
    hidden: integer('hidden', { mode: 'boolean' })
  },
  // Exactly one Group per repository, enforced by this index rather than only
  // in ensureGroupForRepo(), so a second writer can't race a duplicate in.
  (table) => [uniqueIndex('groups_repo_path_unique').on(table.repoPath)]
)

export const groupMessages = sqliteTable(
  'group_messages',
  {
    id: text('id').primaryKey(),
    groupId: text('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    timestamp: integer('timestamp', { mode: 'timestamp_ms' }).notNull(),
    type: text('type', {
      enum: ['system_summary', 'user_mention', 'agent_reply', 'routine_run', 'branch_request']
    }).notNull(),
    // Nullable because a `user_mention` comes from the user, not a contact.
    // set null rather than cascade: the group's history should survive one of
    // its members being deleted.
    contactId: text('contact_id').references(() => contacts.id, { onDelete: 'set null' }),
    content: text('content').notNull(),
    category: text('category', { enum: ['decision', 'tradeoff', 'routine'] }),
    durable: integer('durable', { mode: 'boolean' }),
    /**
     * The branch a `system_summary`'s work landed on, when the session named
     * one. Nullable: a Contact working directly in the repository's own
     * checkout has no branch worth reporting.
     *
     * This column is how the rest of the app finds out that a writer produced
     * work nobody can see on disk. These summaries are already injected into
     * every session on the repository, so a branch named here reaches the
     * other Contacts bound to it without any further plumbing.
     */
    branch: text('branch'),
    /**
     * `branch_request` only: stamped when the branch it asks about is merged
     * or discarded, which is what stops an answered ask reading forever as a
     * standing one.
     */
    resolvedAt: integer('resolved_at', { mode: 'timestamp_ms' })
  },
  (table) => [index('group_messages_group_timestamp_idx').on(table.groupId, table.timestamp)]
)

export const messages = sqliteTable(
  'messages',
  {
    id: text('id').primaryKey(),
    contactId: text('contact_id')
      .notNull()
      .references(() => contacts.id, { onDelete: 'cascade' }),
    role: text('role', { enum: ['user', 'assistant'] }).notNull(),
    content: text('content').notNull(),
    timestamp: integer('timestamp', { mode: 'timestamp_ms' }).notNull(),
    /**
     * What the turn ending in this assistant message did to the working tree,
     * stamped from git in finish(). Null on user rows and on turns that
     * changed nothing, so a chip row only ever appears when there is work to
     * show. JSON because the five fields are written and read together.
     */
    work: text('work', { mode: 'json' }).$type<TurnWork>(),
    /**
     * The backend session that answered this message — what makes a session
     * boundary drawable in the thread.
     *
     * Stamped at turn end for *both* rows of the turn, never at insert. The id
     * does not exist yet when the user's row is written on the first turn of a
     * session; and on the dead-resume heal path an insert-time value would
     * label the question with a key that turned out to be dead and the answer
     * with the live one, drawing a boundary between a question and its own
     * reply. "The session that answered it" is true on every path, the heal
     * included — which is also what makes the heal visible for the first time.
     *
     * Null means not recorded: every row written before 0018, and any turn that
     * died before `session_started`. Deliberately never backfilled — claiming
     * the whole history belongs to the live session is only true back to the
     * last clear and is unknowable from the rows. The renderer treats null as
     * inheriting rather than as a boundary, so an upgrade draws no dividers and
     * the first one it ever draws is a real one.
     */
    sessionId: text('session_id')
  },
  (table) => [index('messages_contact_timestamp_idx').on(table.contactId, table.timestamp)]
)

/**
 * The durable record of what a turn *called*.
 *
 * Name and status alone are not enough: the morning after an unattended
 * routine, "what did it write" has to have an answer, and a live stream that
 * has since scrolled away is not one. So the rows carry *bounded* detail and
 * output excerpts alongside the name and status — never full arguments, and
 * the caps live beside the writer in messaging.ts. These rows exist for the
 * reload and for the morning after.
 *
 * `messageId` is stamped when the turn's assistant message is written; a row
 * still `running` with a null messageId is a turn that died mid-call, and the
 * renderer says "interrupted" rather than pretending it finished. Rows die
 * with their contact, like messages.
 */
export const toolCalls = sqliteTable(
  'tool_calls',
  {
    id: text('id').primaryKey(),
    contactId: text('contact_id')
      .notNull()
      .references(() => contacts.id, { onDelete: 'cascade' }),
    messageId: text('message_id').references(() => messages.id, { onDelete: 'cascade' }),
    /** The backend's per-turn call id — unique within a turn, not globally. */
    toolCallId: text('tool_call_id').notNull(),
    name: text('name').notNull(),
    status: text('status', { enum: ['running', 'completed', 'failed'] }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    /**
     * Bounded excerpts: `detail` is what the call was asked (the command line,
     * the path), capped at TOOL_DETAIL_MAX; `output` is how it answered,
     * capped at TOOL_OUTPUT_MAX. Excerpts rather than the whole thing because
     * these are written on every call of every turn and read back with the
     * thread — enough to answer "what did it do", short of storing a turn's
     * entire I/O in the database. Both nullable: rows from before the columns
     * existed read as absent, and a turn that reported neither stores neither.
     */
    detail: text('detail'),
    output: text('output')
  },
  (table) => [index('tool_calls_contact_created_idx').on(table.contactId, table.createdAt)]
)

export const routines = sqliteTable(
  'routines',
  {
    id: text('id').primaryKey(),
    contactId: text('contact_id')
      .notNull()
      .references(() => contacts.id, { onDelete: 'cascade' }),
    schedule: text('schedule').notNull(),
    prompt: text('prompt').notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull(),
    lastRunAt: integer('last_run_at', { mode: 'timestamp_ms' }),
    lastRunSummary: text('last_run_summary'),
    /**
     * Run history, like the two above — never writable through the editor.
     * Misses accumulate here, durably, because node-cron deliberately does not
     * catch up a missed fire and the armed handles are destroyed and re-created
     * on every routine edit, so an in-memory counter would zero itself whenever
     * anything was saved. Any recorded attempt resets the count — Run now is
     * the catch-up.
     */
    missedRunCount: integer('missed_run_count').notNull().default(0),
    lastMissedAt: integer('last_missed_at', { mode: 'timestamp_ms' }),
    /**
     * Soft monthly spend threshold in USD, null = no budget. User-editable,
     * unlike the run history above — it travels the draft and update shapes
     * and updateRoutine's explicit column list. Alerts only: crossing it
     * notifies and banners, and nothing is ever stopped.
     */
    monthlyBudgetUsd: real('monthly_budget_usd')
  },
  (table) => [index('routines_contact_idx').on(table.contactId)]
)

export const usageEvents = sqliteTable(
  'usage_events',
  {
    id: text('id').primaryKey(),
    /**
     * Nullable, and `set null` rather than `cascade` — the same choice
     * group_messages makes, for a stronger reason. Spend outlives what spent
     * it: a monthly total covering a Contact somebody has since tidied up is
     * still a correct total, so deleting the Contact severs the link instead
     * of taking the rows. Spend is a financial record — it describes money
     * that was actually spent, and no later bookkeeping makes that untrue.
     */
    contactId: text('contact_id').references(() => contacts.id, { onDelete: 'set null' }),
    /**
     * Which routine's fire spent this, when the turn's origin was a routine.
     * Same non-FK rule as personaTemplateId below and for the same reason:
     * spend outlives its attribution target, and a routine deleted next week
     * must not take last month's figures with it. Null on rows from before the
     * column existed — honestly unattributed, never guessed.
     */
    routineId: text('routine_id'),
    /**
     * Copied from the Contact when the row is written, and deliberately **not**
     * foreign keys.
     *
     * Their whole purpose is to outlive the rows they were copied from: a FK
     * would be exactly the coupling that makes deletion destructive, and a
     * `restrict` one would make a persona undeletable for as long as any
     * turn had ever run on it. So these are plain text and may name a persona
     * or a repo that no longer exists — which is the point, because "what was
     * this spent on" stays answerable either way.
     */
    personaTemplateId: text('persona_template_id'),
    repoPath: text('repo_path'),
    timestamp: integer('timestamp', { mode: 'timestamp_ms' }).notNull(),
    /**
     * What spent the tokens. The column is plain `text NOT NULL` in 0002 with
     * no CHECK behind it, so the enum is a Drizzle/Zod assertion rather than a
     * database constraint — a fifth kind of origin needs no migration.
     *
     * Worth separating rather than folding into `message`: a summary turn is
     * spend the user never asked for directly, and the usage dashboard should
     * be able to show the cost of coordination on its own.
     */
    source: text('source', { enum: ['message', 'routine', 'mention', 'summary'] }).notNull(),
    inputTokens: integer('input_tokens').notNull(),
    outputTokens: integer('output_tokens').notNull(),
    cachedInputTokens: integer('cached_input_tokens'),
    /**
     * REAL, not INTEGER — a turn costs fractions of a cent, and INTEGER
     * affinity on a dollar amount is the kind of thing that reads fine until
     * someone rounds it. Null when there is no dollar figure to record: a
     * backend may return token counts only, and a model may have no published
     * price to compute one from.
     */
    costUsd: real('cost_usd'),
    /**
     * The model that served this turn, recorded per event rather than read off
     * the persona. A persona's model can be changed at any time, and pricing
     * differs by an order of magnitude between them — attributing old spend to
     * the current setting would silently reprice history.
     */
    model: text('model'),
    /**
     * Whether costUsd came from the backend or from our own price table
     * (src/main/adapters/pricing.ts). The dashboard should not present an
     * estimate we computed and a figure the vendor returned as the same kind
     * of number.
     */
    costSource: text('cost_source', { enum: ['sdk', 'computed'] }),
    /** Both backends report these; neither is included in the two above. */
    cacheWriteInputTokens: integer('cache_write_input_tokens'),
    reasoningOutputTokens: integer('reasoning_output_tokens'),
    /**
     * The backend session this turn belonged to. Nullable, and it exists for
     * one reason: Codex reports token usage **cumulatively across a thread**,
     * not per turn, so recording what it says would over-report every turn
     * after the first by a growing margin. Summing the deltas already recorded
     * for a session gives the baseline to subtract — see baselineFor() in
     * services/usage-events.ts.
     *
     * Rows written before this column existed carry NULL and are excluded from
     * that sum, so an already-running Codex thread over-reports once more and
     * is exact from then on. Cheaper than a backfill that would have to guess
     * which historical rows were deltas and which were cumulative readings.
     */
    sessionId: text('session_id'),
    /**
     * The assistant message this turn produced, so a single turn's cost is
     * reachable in the thread and not only in aggregates. The data is per-event
     * either way; this is the column that ties an event to the reply it paid
     * for.
     *
     * Written in `finish()`, where the id is already in hand — the same place
     * and moment the turn's tool rows and session stamp are written.
     * Correlating by timestamp instead was rejected: usage rows are written
     * *after* the message, but a turn that produces no final text writes a
     * usage row and no message at all, compaction records `summary` spend with
     * neither message nor session, and a mention writes two message rows for
     * one usage row. Each of those is a case where a positional pairing
     * silently attributes a cost to the wrong reply.
     *
     * `set null` on delete rather than `cascade`, and this is the load-bearing
     * half: `messages` cascades from `contacts`, so a cascading FK here would
     * delete the spend record whenever a contact is deleted. The rule is that
     * spend outlives what spent it — `contact_id` is `set null` for exactly
     * this reason, and this column has to match, or the usage dashboard's
     * history quietly loses a month every time someone tidies up.
     *
     * Null means "not recorded": every row written before this column existed,
     * and every turn that legitimately has no reply to point at.
     */
    messageId: text('message_id').references(() => messages.id, { onDelete: 'set null' })
  },
  (table) => [
    index('usage_events_contact_timestamp_idx').on(table.contactId, table.timestamp),
    /**
     * The two columns migration 0008 denormalised, finally indexed (Phase 25 §B4).
     *
     * `repo_path` and `persona_template_id` were copied onto this table for one
     * stated purpose — so spend could still be grouped by them after the Contact
     * that spent it was deleted — and then every grouping read scanned the whole
     * table to do it. Paired with `timestamp` because no caller wants one of
     * these without a range: the dashboard always asks within 7 days, 30 days or
     * all, and a covering pair lets SQLite answer without visiting the row.
     */
    index('usage_events_repo_timestamp_idx').on(table.repoPath, table.timestamp),
    index('usage_events_persona_timestamp_idx').on(table.personaTemplateId, table.timestamp)
  ]
)

/**
 * A durable record of repo/contact governance actions — who granted repo
 * trust, who bound or removed a Contact, who merged a branch — none of which
 * left a trace before this table existed.
 *
 * Same survivability rule as usage_events, for the same reason: an audit
 * record that could be erased by deleting the thing it describes is not an
 * audit record. `contactId` is a real FK, `set null` on delete; `repoPath`
 * and `personaTemplateId` are plain copied text with no FK, since there is no
 * `repos` table and a persona template can be deleted or a Contact rebound
 * independently of its history.
 */
export const auditEvents = sqliteTable(
  'audit_events',
  {
    id: text('id').primaryKey(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    action: text('action', {
      enum: [
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
      ]
    }).notNull(),
    // A Drizzle/Zod assertion rather than a DB CHECK, matching isolation and
    // source above — a fourth actor kind needs no migration.
    actorKind: text('actor_kind', { enum: ['user', 'routine', 'system'] }).notNull(),
    // Plain text, no FK — same rule as usage_events.routineId: a routine
    // deleted next week must not take its audit trail with it.
    actorRoutineId: text('actor_routine_id'),
    contactId: text('contact_id').references(() => contacts.id, { onDelete: 'set null' }),
    repoPath: text('repo_path').notNull(),
    personaTemplateId: text('persona_template_id'),
    /**
     * Precomputed human-readable line, written where the actor has full
     * context — cheaper and more testable than reconstructing 16 different
     * shapes from `metadata` at read time.
     */
    summary: text('summary').notNull(),
    /** Action-specific old/new values. Same JSON-column treatment as repoTrust. */
    metadata: text('metadata', { mode: 'json' }).$type<Record<string, unknown>>()
  },
  (table) => [
    // The two list groupings the UI actually needs: a repo's activity, and a
    // contact's activity.
    index('audit_events_repo_path_created_idx').on(table.repoPath, table.createdAt),
    index('audit_events_contact_created_idx').on(table.contactId, table.createdAt)
  ]
)
