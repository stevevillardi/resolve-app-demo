import { defineConfig } from '@playwright/test'

/**
 * Electron E2E. Separate from Vitest: these launch the real built app, so they
 * cover the preload bridge, the IPC round trip, and migrations running against
 * a real SQLite file — none of which unit tests can reach.
 *
 * Requires `npm run build` first; the specs assert that and fail loudly rather
 * than silently testing a stale bundle.
 */
export default defineConfig({
  // Each spec launches its own Electron instance against its own profile;
  // running them concurrently makes for a slow, flaky race over the GPU.
  workers: 1,
  fullyParallel: false,
  // A cold Electron launch plus migrations is slow on a loaded CI box.
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? 'list' : [['list'], ['html', { open: 'never' }]],
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,

  /**
   * Two projects, because `e2e/screenshots/` is not a test suite.
   *
   * The sweep drives every screen and photographs it; its output is for a human
   * to look at, and it asserts almost nothing. Left in the default project it
   * would add minutes to `test:e2e` and report a green tick for work nobody had
   * reviewed. A project split rather than a filename convention, so a new file
   * in that directory cannot accidentally join the real suite.
   */
  projects: [
    { name: 'e2e', testDir: './e2e', testIgnore: '**/screenshots/**' },
    { name: 'screens', testDir: './e2e/screenshots', testMatch: '**/*.sweep.ts' }
  ]
})
