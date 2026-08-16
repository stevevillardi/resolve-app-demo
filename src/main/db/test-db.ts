import { resolve } from 'path'
import { createDb, type AppDatabase } from './create'

/**
 * A fresh `:memory:` database with every checked-in migration applied.
 *
 * Deliberately runs the real `drizzle/` folder rather than hand-written
 * `CREATE TABLE`s: eight tables' worth of copied DDL would drift from the
 * migrations the moment anyone changed one, and the drift would show up as
 * tests passing against a schema the app doesn't actually have. Going through
 * migrate() also exercises the migration files themselves on every run, along
 * with the `foreign_keys` pragma that several services' behaviour depends on.
 *
 * Test-only. It lives here rather than in a test folder because it imports
 * createDb, and resolves `drizzle/` from the repo root — vitest's cwd.
 */
export function createTestDb(): AppDatabase {
  return createDb(':memory:', resolve('drizzle'))
}
