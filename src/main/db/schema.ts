import { sqliteTable, integer, text } from 'drizzle-orm/sqlite-core'

// TEMP: Phase 1 bootstrap only, proves the migration pipeline works end to end.
// Deleted when Phase 4 (docs/plan/04-data-layer.md) lands the real schema.
export const bootstrapCheck = sqliteTable('_bootstrap_check', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull()
})

/**
 * App-level key/value state (Phase 3). Unlike `_bootstrap_check` above this is
 * permanent — Phase 4 inherits it rather than dropping it.
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
