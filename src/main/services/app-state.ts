import { eq } from 'drizzle-orm'
import { initDb } from '../db'
import { appState } from '../db/schema'

/**
 * Non-secret app-level key/value state. Secrets go to services/secrets.ts —
 * nothing written through here is encrypted, and that's deliberate: it should
 * stay safe to `sqlite3 switchboard.db "select * from app_state"`.
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
  /**
   * OS notifications on/off. Absence means ON — the unattended story is the
   * reason they exist, so the toggle is an opt-out. See notifications.ts.
   */
  | 'notifications_enabled'
  /**
   * App-level soft monthly spend threshold in USD, as a decimal string.
   * Absent = no budget. Alerts only, never enforcement. See budget-alerts.ts.
   */
  | 'monthly_budget_usd'
  /**
   * Which month each budget scope last alerted for, as a JSON map
   * ({"app": "2026-08", "routine:<id>": "2026-07"}). The edge-trigger:
   * recordUsage runs every turn, and without this a crossed budget would
   * toast once per turn for the rest of the month. Sticky across restarts,
   * same trick as github_token_state; re-armed by the month rolling over.
   */
  | 'budget_alerts_fired'

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

/** A stored decimal, or null when absent or unparseable — never NaN. */
export function getAppStateNumber(key: AppStateKey): number | null {
  const raw = getAppState(key)
  if (raw === null) return null
  const value = Number(raw)
  return Number.isFinite(value) ? value : null
}

export function setAppStateNumber(key: AppStateKey, value: number): void {
  setAppState(key, String(value))
}

export function getAppStateFlag(key: AppStateKey): boolean {
  return getAppState(key) === 'true'
}

export function setAppStateFlag(key: AppStateKey, value: boolean): void {
  setAppState(key, value ? 'true' : 'false')
}
