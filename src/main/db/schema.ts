import { sqliteTable, integer, real, text, index, uniqueIndex } from 'drizzle-orm/sqlite-core'

/**
 * Blueprint §12, one table per bullet. The column shapes mirror the Zod
 * schemas in src/shared/domain.ts — that file is the contract, this one is how
 * it lands on disk, and src/main/db/mappers.ts converts between them.
 *
 * Foreign keys here are only real because initDb() turns on
 * `PRAGMA foreign_keys` — better-sqlite3 leaves it off by default, which would
 * make every reference below decorative.
 */

/**
 * App-level key/value state (Phase 3). Permanent, unlike the Phase 1
 * `_bootstrap_check` table this migration drops.
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
   * A JSON array rather than a join table, per blueprint §4. Skills are
   * injected text with no relational queries over them, and the ordering the
   * user picked is worth keeping — a join table would lose it or need a
   * position column to fake it back.
   */
  skillIds: text('skill_ids', { mode: 'json' }).$type<string[]>().notNull(),
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
     * somewhere else, so blueprint §4's "one Group per repo" and the
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
    /** The branch its worktree is on. Null whenever worktree_path is. */
    branch: text('branch'),
    /**
     * Where the session runs, chosen per Contact at bind time (§4) — the same
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
    isolation: text('isolation', { enum: ['shared', 'worktree', 'exclusive'] })
  },
  (table) => [index('contacts_repo_path_idx').on(table.repoPath)]
)

export const groups = sqliteTable(
  'groups',
  {
    id: text('id').primaryKey(),
    repoPath: text('repo_path').notNull()
  },
  // Blueprint §4: exactly one Group per repo. Enforced here rather than only
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
      enum: ['system_summary', 'user_mention', 'agent_reply', 'routine_run']
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
     * one. Nullable and unwritten in practice until worktrees land: every
     * Contact shares one checkout today, so there is rarely a branch worth
     * reporting.
     *
     * Added now rather than later because this column is how the rest of the
     * repo finds out that a writer produced work nobody can see on disk — see
     * docs/plan/12-worktree-isolation.md, which is built on Phase 7 already
     * injecting these rows into every session on the repo. Retrofitting it
     * would mean a migration plus a re-summarisation pass over history.
     */
    branch: text('branch')
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
    timestamp: integer('timestamp', { mode: 'timestamp_ms' }).notNull()
  },
  (table) => [index('messages_contact_timestamp_idx').on(table.contactId, table.timestamp)]
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
    lastRunSummary: text('last_run_summary')
  },
  (table) => [index('routines_contact_idx').on(table.contactId)]
)

export const usageEvents = sqliteTable(
  'usage_events',
  {
    id: text('id').primaryKey(),
    contactId: text('contact_id')
      .notNull()
      .references(() => contacts.id, { onDelete: 'cascade' }),
    timestamp: integer('timestamp', { mode: 'timestamp_ms' }).notNull(),
    /**
     * What spent the tokens. `mention` and `summary` joined the original two
     * in Phase 7 and needed no migration: the column is plain `text NOT NULL`
     * in 0002 with no CHECK behind it, so the enum is a Drizzle/Zod assertion
     * rather than a database constraint.
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
     * someone rounds it. Null when the model has no published price (§3).
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
    sessionId: text('session_id')
  },
  (table) => [index('usage_events_contact_timestamp_idx').on(table.contactId, table.timestamp)]
)
