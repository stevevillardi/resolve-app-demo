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
    repoPath: text('repo_path').notNull(),
    displayName: text('display_name').notNull(),
    backendSessionId: text('backend_session_id')
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
    durable: integer('durable', { mode: 'boolean' })
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
    source: text('source', { enum: ['message', 'routine'] }).notNull(),
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
    reasoningOutputTokens: integer('reasoning_output_tokens')
  },
  (table) => [index('usage_events_contact_timestamp_idx').on(table.contactId, table.timestamp)]
)
