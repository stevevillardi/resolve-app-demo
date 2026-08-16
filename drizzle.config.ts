import { defineConfig } from 'drizzle-kit'

// drizzle-kit runs standalone (outside Electron), so it can't resolve
// app.getPath('userData') — this local file is only a diff target for
// `drizzle-kit generate`, not the database the app actually uses at runtime.
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/main/db/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: './.drizzle-dev.db'
  }
})
