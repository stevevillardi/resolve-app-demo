import { test, expect } from '@playwright/test'
import { existsSync, readdirSync } from 'fs'
import { join } from 'path'
import {
  createProfile,
  destroyProfile,
  invoke,
  launchApp,
  waitForShell,
  type AuthStatus,
  type LaunchedApp
} from './fixtures'

/**
 * The Phase 3 launch flow, end to end against the real app: splash →
 * onboarding → shell. Covers the preload bridge, the IPC round trip, and
 * migrations running against a real SQLite file — the parts unit tests
 * structurally cannot reach.
 *
 * Everything runs against a throwaway profile with HOME and CODEX_HOME
 * redirected, so this is a genuine fresh install and the developer's real
 * credentials are never touched.
 */

let profile: string
let launched: LaunchedApp

test.beforeAll(async () => {
  profile = createProfile()
  launched = await launchApp(profile)
})

test.afterAll(async () => {
  await launched?.app.close().catch(() => {})
  destroyProfile(profile)
})

test.describe('first run', () => {
  test('lands on onboarding, not the shell', async () => {
    const { window } = launched
    await expect(window.getByRole('heading', { name: 'Welcome to Persona Router' })).toBeVisible()
  })

  test('offers all three backends', async () => {
    const { window } = launched
    for (const name of ['Claude', 'Codex', 'GitHub']) {
      await expect(window.getByText(name, { exact: true })).toBeVisible()
    }
    // GitHub is the one backend whose credential is scoped to userData, so a
    // fresh profile reliably has no token and must offer to connect.
    await expect(window.getByRole('button', { name: /Connect with GitHub/ })).toBeVisible()
  })

  test('the splash does not outlive the auth check', async () => {
    const { window } = launched
    await expect(window.getByText('Checking your connections…')).toBeHidden()
  })

  test('auth.getStatus reports each backend independently', async () => {
    const status = await invoke<AuthStatus>(launched.window, 'auth.getStatus')

    // Claude is deliberately NOT asserted as unauthenticated. Its Claude Code
    // login lives in the macOS Keychain, not under HOME, so redirecting HOME
    // cannot isolate it — a developer logged into Claude Code will see
    // authenticated: true here, and that's correct behaviour, not a leak of
    // test state. GitHub and Codex are profile-scoped and can be asserted.
    expect(status).toMatchObject({
      codex: { authenticated: false },
      github: { connected: false, configured: true },
      onboardingCompleted: false
    })
    expect(typeof status.claude.authenticated).toBe('boolean')

    // The three are separate objects, not one collapsed flag.
    expect(Object.keys(status).sort()).toEqual([
      'claude',
      'codex',
      'github',
      'onboardingCompleted',
      'secretStorageAvailable'
    ])
  })

  test('rejects an unknown procedure through the real bridge', async () => {
    await expect(invoke(launched.window, 'auth.definitelyNotReal')).rejects.toThrow(
      /Unknown IPC procedure/
    )
  })

  test('enforces contract validation through the real bridge', async () => {
    await expect(
      invoke(launched.window, 'auth.setAnthropicApiKey', { apiKey: '' })
    ).rejects.toThrow()
  })
})

test.describe('database', () => {
  test('creates the SQLite file and applies both migrations', async () => {
    const dbPath = join(profile, 'userData', 'persona-router.db')
    expect(existsSync(dbPath)).toBe(true)

    // app_state is queryable, which only holds if 0001 ran.
    const status = await invoke<AuthStatus>(launched.window, 'auth.getStatus')
    expect(status.onboardingCompleted).toBe(false)
  })

  test('stores no credentials on a profile that never authenticated', () => {
    const secrets = join(profile, 'userData', 'secrets')
    if (existsSync(secrets)) expect(readdirSync(secrets)).toEqual([])
  })
})

test.describe('completing onboarding', () => {
  test('persists across a relaunch and lands in the shell', async () => {
    await invoke(launched.window, 'auth.completeOnboarding')

    // Relaunch against the same profile — the returning-user path.
    await launched.app.close()
    launched = await launchApp(profile)
    const { window } = launched

    await waitForShell(window)
    await expect(window.getByRole('heading', { name: 'Welcome to Persona Router' })).toBeHidden()
    await expect(window.locator('[data-slot="sidebar"]')).toBeAttached()

    const status = await invoke<AuthStatus>(window, 'auth.getStatus')
    expect(status.onboardingCompleted).toBe(true)
  })

  test('still reports GitHub as disconnected after a skipped setup', async () => {
    const { window } = launched
    await waitForShell(window)

    // Skipping is a first-class exit; the app must not pretend otherwise.
    const status = await invoke<AuthStatus>(window, 'auth.getStatus')
    expect(status.github.connected).toBe(false)
    // The sidebar dot reflects it too, rather than only the IPC layer knowing.
    await expect(window.locator('[data-connected="false"]').first()).toBeVisible()
  })
})

test.describe('device flow state machine', () => {
  test('starts idle and survives a cancel with no flow running', async () => {
    const { window } = launched
    await expect(invoke(window, 'github.cancelDeviceFlow')).resolves.toMatchObject({
      status: 'idle'
    })
    await expect(invoke(window, 'codex.getLoginState')).resolves.toMatchObject({ status: 'idle' })
  })

  test('disconnecting GitHub is safe when never connected', async () => {
    await expect(invoke(launched.window, 'github.disconnect')).resolves.toMatchObject({
      connected: false
    })
  })
})

test.describe('shell.openExternal allowlist', () => {
  test('refuses a host that is not a known verification URL', async () => {
    // The renderer must not be able to turn this into a general "open
    // anything" primitive.
    await expect(
      invoke(launched.window, 'shell.openExternal', { url: 'https://evil.example.com/phish' })
    ).resolves.toMatchObject({ opened: false })
  })

  test('refuses a non-https scheme on an allowed host', async () => {
    await expect(
      invoke(launched.window, 'shell.openExternal', { url: 'http://github.com/login/device' })
    ).resolves.toMatchObject({ opened: false })
  })
})
