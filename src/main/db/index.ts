import { app } from 'electron'
import { join } from 'path'
import Database from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import * as schema from './schema'

let db: BetterSQLite3Database<typeof schema> | null = null

export function initDb(): BetterSQLite3Database<typeof schema> {
  if (db) return db

  const dbPath = join(app.getPath('userData'), 'persona-router.db')
  const sqlite = new Database(dbPath)
  sqlite.pragma('journal_mode = WAL')

  db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder: getMigrationsFolder() })

  return db
}

function getMigrationsFolder(): string {
  // Packaged app: migrations ship unpacked as an extraResource (see electron-builder.yml).
  // Dev: read straight from the repo.
  return app.isPackaged ? join(process.resourcesPath, 'drizzle') : join(__dirname, '../../drizzle')
}
