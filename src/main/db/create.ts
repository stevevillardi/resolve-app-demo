import Database from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import * as schema from './schema'

export type AppDatabase = BetterSQLite3Database<typeof schema>

/**
 * Opens a database, applies the pragmas, and runs every migration in
 * `migrationsFolder`.
 *
 * Kept out of ./index.ts so it can be imported without pulling in `electron` —
 * that's what lets test-db.ts build an identically migrated `:memory:`
 * instance instead of hand-copying DDL that then drifts from the real
 * migrations.
 */
export function createDb(path: string, migrationsFolder: string): AppDatabase {
  const sqlite = new Database(path)
  sqlite.pragma('journal_mode = WAL')
  // OFF by default in better-sqlite3, which would make every `references()` in
  // schema.ts decorative — including the restrict that stops a persona being
  // deleted out from under its contacts.
  sqlite.pragma('foreign_keys = ON')

  const instance = drizzle(sqlite, { schema })
  migrate(instance, { migrationsFolder })
  return instance
}
