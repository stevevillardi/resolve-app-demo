import { app } from 'electron'
import { join } from 'path'
import { createDb, type AppDatabase } from './create'

export type { AppDatabase }

let db: AppDatabase | null = null

export function initDb(): AppDatabase {
  if (db) return db
  db = createDb(join(app.getPath('userData'), 'persona-router.db'), getMigrationsFolder())
  return db
}

function getMigrationsFolder(): string {
  // Packaged app: migrations ship unpacked as an extraResource (see electron-builder.yml).
  // Dev: read straight from the repo.
  return app.isPackaged ? join(process.resourcesPath, 'drizzle') : join(__dirname, '../../drizzle')
}
