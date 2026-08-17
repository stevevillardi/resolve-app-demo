import { expect, test } from '@playwright/test'
import {
  anyWindowVisible,
  closeWindow,
  createProfile,
  destroyProfile,
  destroyWindow,
  invoke,
  launchApp,
  readProfileDb,
  windowCount,
  type LaunchedApp
} from './fixtures'

/**
 * Blueprint §15E's hard requirement: a routine that only fires while the window
 * happens to be open is useless.
 *
 * The thing under test is **residency**, not that a model answered. The
 * throwaway profile has no credentials, so the turn fails fast and the routine
 * records `Failed — ...` — and that non-null `last_run_at`, written while there
 * was no window on screen, is the whole proof. Asserting on a real reply would
 * mean spending money on every E2E run, which is why no spec in this suite
 * starts a turn.
 *
 * Observed by reading the profile's SQLite directly: `invoke` needs a renderer,
 * and the acceptance check is about durable state anyway.
 */

test.describe.configure({ timeout: 180_000 })

let profile: string
let launched: LaunchedApp

const ROUTINE_ID_SQL = 'select id, last_run_at, last_run_summary from routines'

test.beforeAll(async () => {
  profile = createProfile()
  launched = await launchApp(profile)
  await launched.window.waitForFunction(() => 'api' in window)

  const persona = await invoke<{ id: string }>(launched.window, 'personas.create', {
    name: 'Nightly Sweeper',
    avatarColor: '#2a78d6',
    backend: 'claude',
    model: null,
    systemPrompt: 'Sweep the repo.',
    skillIds: [],
    // Required since migration 0009, and not optional in the draft: an empty
    // allowlist is a decision (this persona reaches no MCP server), so it has
    // to be stated rather than inferred from its absence.
    mcpServerIds: [],
    sandbox: 'read_only',
    githubScope: 'open_pr'
  })

  const contact = await invoke<{ id: string }>(launched.window, 'contacts.create', {
    personaTemplateId: persona.id,
    repoPath: profile,
    displayName: 'Nightly Sweeper'
  })

  // Six-field, seconds precision — node-cron 4.x accepts it, so this test
  // finishes in seconds rather than waiting out a whole minute.
  await invoke(launched.window, 'routines.create', {
    contactId: contact.id,
    schedule: '*/2 * * * * *',
    prompt: 'Report anything that changed.',
    enabled: true
  })
})

test.afterAll(async () => {
  await launched?.app.close()
  destroyProfile(profile)
})

test('a routine fires while the window is closed', async () => {
  await closeWindow(launched.app)
  expect(await anyWindowVisible(launched.app)).toBe(false)

  await expect
    .poll(
      async () => {
        // Re-asserted on every poll, so a fire that only happened because
        // something re-showed the window cannot pass by accident.
        expect(await anyWindowVisible(launched.app)).toBe(false)
        return readProfileDb<{ last_run_at: number | null }>(profile, ROUTINE_ID_SQL)[0]
          ?.last_run_at
      },
      { timeout: 60_000, message: 'routine never fired with the window closed' }
    )
    .not.toBeNull()

  const [row] = readProfileDb<{ last_run_summary: string | null }>(profile, ROUTINE_ID_SQL)
  // It ran and recorded an outcome. Which outcome depends on credentials the
  // throwaway profile deliberately does not have.
  expect(row.last_run_summary).toBeTruthy()
})

test('and again with no window in existence at all', async () => {
  // The stricter form: `close` only hides, so the test above proves firing with
  // a hidden window. This destroys it, so `getAllWindows()` is genuinely empty.
  await destroyWindow(launched.app)
  expect(await windowCount(launched.app)).toBe(0)

  const before = readProfileDb<{ last_run_at: number }>(profile, ROUTINE_ID_SQL)[0].last_run_at

  await expect
    .poll(
      async () => {
        expect(await windowCount(launched.app)).toBe(0)
        return readProfileDb<{ last_run_at: number }>(profile, ROUTINE_ID_SQL)[0].last_run_at
      },
      { timeout: 60_000, message: 'routine never fired again with zero windows' }
    )
    .toBeGreaterThan(before)
})
