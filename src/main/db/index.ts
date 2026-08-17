import { app } from 'electron'
import { join } from 'path'
import { createDb, rawHandle, type AppDatabase } from './create'

export type { AppDatabase }

/** One place for the filename, so the reset service cannot drift from it. */
export const DB_FILE_NAME = 'switchboard.db'

let db: AppDatabase | null = null

export function initDb(): AppDatabase {
  if (db) return db
  db = createDb(join(app.getPath('userData'), DB_FILE_NAME), getMigrationsFolder())
  return db
}

/**
 * Closes the underlying SQLite handle and forgets it (Phase 18, for the dev
 * reset). Deleting the file while a handle is open leaks an fd to a dead
 * inode on macOS and fails outright on Windows; nothing else may unlink the
 * database without coming through here first. The next initDb() reopens.
 */
export function closeDb(): void {
  if (!db) return
  rawHandle(db)?.close()
  db = null
}

function getMigrationsFolder(): string {
  // Packaged app: migrations ship unpacked as an extraResource (see electron-builder.yml).
  // Dev: read straight from the repo.
  return app.isPackaged ? join(process.resourcesPath, 'drizzle') : join(__dirname, '../../drizzle')
}
