import { sqliteTable, integer } from 'drizzle-orm/sqlite-core'

// TEMP: Phase 1 bootstrap only, proves the migration pipeline works end to end.
// Deleted when Phase 4 (docs/plan/04-data-layer.md) lands the real schema.
export const bootstrapCheck = sqliteTable('_bootstrap_check', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull()
})
