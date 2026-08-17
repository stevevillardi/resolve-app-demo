import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { existsSync, mkdtempSync, rmSync } from 'fs'
// node:sqlite rather than better-sqlite3 — see readProfileDb below.
import { DatabaseSync } from 'node:sqlite'
import { join, resolve } from 'path'
import { tmpdir } from 'os'

const APP_ROOT = resolve(__dirname, '..')

/**
 * A disposable app instance: its own userData, HOME and CODEX_HOME, so a test
 * run can never read, write, or invalidate the developer's real Claude, Codex,
 * or GitHub credentials — and so every run genuinely starts as a fresh install.
 */
export interface LaunchedApp {
  app: ElectronApplication
  window: Page
  /** userData for this instance; survives close() so a relaunch can reuse it. */
  profile: string
}

export function createProfile(): string {
  return mkdtempSync(join(tmpdir(), 'switchboard-e2e-'))
}

export function destroyProfile(profile: string): void {
  rmSync(profile, { recursive: true, force: true })
}

export async function launchApp(profile: string): Promise<LaunchedApp> {
  const mainBundle = join(APP_ROOT, 'out', 'main', 'index.js')
  if (!existsSync(mainBundle)) {
    throw new Error(`out/main/index.js is missing — run \`npm run build\` before the E2E suite.`)
  }

  const home = join(profile, 'home')
  const app = await electron.launch({
    args: [APP_ROOT, `--user-data-dir=${join(profile, 'userData')}`],
    env: {
      ...process.env,
      NODE_ENV: 'production',
      // Point every credential lookup at the throwaway profile. Without this
      // the app would find the developer's real logins and the "fresh install"
      // assertions would be meaningless.
      HOME: home,
      USERPROFILE: home,
      CODEX_HOME: join(home, '.codex'),
      CLAUDE_CONFIG_DIR: join(home, '.claude'),
      ANTHROPIC_API_KEY: '',
      OPENAI_API_KEY: ''
    }
  })

  const window = await app.firstWindow()
  await window.waitForLoadState('domcontentloaded')
  return { app, window, profile }
}

/**
 * Waits for the main shell to be on screen.
 *
 * Note the nav rail's labels are `display:none` while it's collapsed, so its
 * buttons have no accessible name — role/name queries won't find them. The
 * sidebar's data-slot is the stable handle.
 */
export async function waitForShell(window: Page): Promise<void> {
  await window.waitForSelector('[data-slot="sidebar"]', { state: 'attached' })
}

/**
 * Waits for the preload bridge, without caring which screen is on top.
 *
 * Use this rather than waitForShell whenever a test only needs IPC: the shell
 * doesn't exist until onboarding is complete, so waiting on the sidebar in a
 * profile that hasn't onboarded yet just times out against the splash.
 */
export async function waitForBridge(window: Page): Promise<void> {
  await window.waitForFunction(() => 'api' in window)
}

/** Calls an IPC procedure through the real preload bridge. */
export function invoke<T = unknown>(window: Page, name: string, input?: unknown): Promise<T> {
  return window.evaluate(
    ([procedure, payload]) =>
      (
        window as unknown as { api: { invoke: (n: string, i: unknown) => Promise<unknown> } }
      ).api.invoke(procedure as string, payload),
    [name, input] as const
  ) as Promise<T>
}

export interface AuthStatus {
  claude: { authenticated: boolean; source: string | null; error?: string }
  codex: { authenticated: boolean; source: string | null; error?: string }
  github: { connected: boolean; configured: boolean; login?: string }
  onboardingCompleted: boolean
  secretStorageAvailable: boolean
}

// --- Observing the app with no window on screen (Phase 8) --------------------
// Routines have to keep firing once the window is closed, which every fixture
// above is unable to watch: `invoke` needs a renderer to reach the bridge, and
// `app.close()` ends the whole process rather than just the window.

/** Closes the window the way the traffic light does — main hides it instead. */
export async function closeWindow(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows().forEach((window) => window.close())
  })
}

/** Destroys the window outright, bypassing the close handler: genuinely zero windows. */
export async function destroyWindow(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows().forEach((window) => window.destroy())
  })
}

export function windowCount(app: ElectronApplication): Promise<number> {
  return app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)
}

export function anyWindowVisible(app: ElectronApplication): Promise<boolean> {
  return app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().some((window) => window.isVisible())
  )
}

/**
 * Reads the live profile database from the test process.
 *
 * `node:sqlite` rather than better-sqlite3 on purpose: `postinstall` rebuilds
 * better-sqlite3 against Electron's ABI, so loading it under plain Node is a
 * coincidence of prebuild selection rather than something to depend on. The DB
 * is in WAL mode (see db/create.ts), so a second-process reader sees committed
 * writes immediately.
 *
 * This is the honest observation surface for "did it fire with no window": the
 * acceptance check is about durable state, and reaching into main for a test
 * hook would mean shipping a backdoor to make a test convenient.
 */
export function readProfileDb<T = Record<string, unknown>>(
  profile: string,
  sql: string,
  ...params: unknown[]
): T[] {
  const db = new DatabaseSync(join(profile, 'userData', 'switchboard.db'), { readOnly: true })
  try {
    return db.prepare(sql).all(...(params as never[])) as T[]
  } finally {
    db.close()
  }
}

/**
 * Writes into the profile database — **only while the app is closed**. The
 * app holds an open WAL connection; a second writer against it is a
 * SQLITE_BUSY flake waiting for CI. Used to stage the states only a dead
 * process leaves behind (a crash's orphans, history to search), which no
 * IPC procedure can or should create. Triggers fire here exactly as they do
 * for the app's own writes — same database, same DDL.
 */
export function writeProfileDb(profile: string, sql: string, ...params: unknown[]): void {
  const db = new DatabaseSync(join(profile, 'userData', 'switchboard.db'))
  try {
    db.prepare(sql).run(...(params as never[]))
  } finally {
    db.close()
  }
}
