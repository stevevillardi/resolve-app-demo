import { eq } from 'drizzle-orm'
import { initDb } from '../db'
import { appState } from '../db/schema'

/**
 * Non-secret app-level key/value state. Secrets go to services/secrets.ts —
 * nothing written through here is encrypted, and that's deliberate: it should
 * stay safe to `sqlite3 persona-router.db "select * from app_state"`.
 */
export type AppStateKey =
  | 'onboarding_completed'
  | 'github_account_login'
  | 'github_scopes'
  /**
   * Whether the stored token still works. Set the moment GitHub answers, and
   * sticky across restarts — a revoked token is revoked tomorrow too, and the
   * app claiming otherwise until the next failed request is the defect this
   * exists to close. See services/github-token-state.ts.
   */
  | 'github_token_state'
  /** Set once the first-run defaults have been inserted. See services/seed.ts. */
  | 'seed_version'
  /**
   * Where cloned repos land. Chosen by the user the first time a clone is
   * needed rather than defaulted, since ~/Developer, ~/code and ~/src are each
   * somebody's convention. See services/repos.ts.
   */
  | 'workspace_root'

export function getAppState(key: AppStateKey): string | null {
  const row = initDb().select().from(appState).where(eq(appState.key, key)).get()
  return row?.value ?? null
}

export function setAppState(key: AppStateKey, value: string): void {
  initDb()
    .insert(appState)
    .values({ key, value })
    .onConflictDoUpdate({ target: appState.key, set: { value } })
    .run()
}

export function deleteAppState(key: AppStateKey): void {
  initDb().delete(appState).where(eq(appState.key, key)).run()
}

export function getAppStateFlag(key: AppStateKey): boolean {
  return getAppState(key) === 'true'
}

export function setAppStateFlag(key: AppStateKey, value: boolean): void {
  setAppState(key, value ? 'true' : 'false')
}
