import { test, expect } from '@playwright/test'
import { existsSync, readdirSync } from 'fs'
import { join } from 'path'
import {
  createProfile,
  destroyProfile,
  invoke,
  launchApp,
  waitForBridge,
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
  test('creates the SQLite file and applies every migration', async () => {
    const dbPath = join(profile, 'userData', 'persona-router.db')
    expect(existsSync(dbPath)).toBe(true)

    // app_state is queryable, which only holds if 0001 ran.
    const status = await invoke<AuthStatus>(launched.window, 'auth.getStatus')
    expect(status.onboardingCompleted).toBe(false)

    // The Phase 4 tables are queryable, which only holds if 0002 ran.
    await expect(invoke(launched.window, 'skills.list')).resolves.toBeInstanceOf(Array)
    await expect(invoke(launched.window, 'personas.list')).resolves.toBeInstanceOf(Array)
    await expect(invoke(launched.window, 'contacts.list')).resolves.toBeInstanceOf(Array)
    await expect(invoke(launched.window, 'groups.list')).resolves.toBeInstanceOf(Array)
  })

  test('seeds the default skills and personas on a fresh profile', async () => {
    const skills = await invoke<{ id: string }[]>(launched.window, 'skills.list')
    const personas = await invoke<{ id: string; skillIds: string[] }[]>(
      launched.window,
      'personas.list'
    )
    expect(skills.length).toBeGreaterThan(0)
    expect(personas.length).toBeGreaterThan(0)

    // Every attachment resolves — a persona pointing at a skill that wasn't
    // seeded would render an entry the editor can't show or remove.
    const ids = new Set(skills.map((skill) => skill.id))
    for (const persona of personas) {
      for (const id of persona.skillIds) expect(ids).toContain(id)
    }
  })

  test('seeds no contacts or groups — those need a real repo path', async () => {
    expect(await invoke(launched.window, 'contacts.list')).toEqual([])
    expect(await invoke(launched.window, 'groups.list')).toEqual([])
  })

  test('rejects a malformed create at the boundary', async () => {
    await expect(
      invoke(launched.window, 'personas.create', { name: 'X', backend: 'cursor' })
    ).rejects.toThrow()
  })

  test('stores no credentials on a profile that never authenticated', () => {
    const secrets = join(profile, 'userData', 'secrets')
    if (existsSync(secrets)) expect(readdirSync(secrets)).toEqual([])
  })
})

test.describe('persistence', () => {
  test('a created skill survives a relaunch, and a deleted seed does not return', async () => {
    const created = await invoke<{ id: string; name: string }>(launched.window, 'skills.create', {
      name: 'Survives Relaunch',
      description: 'Written in one process, read in the next.',
      content: '# Persisted'
    })

    // Deleting a seeded skill is the case the seed marker exists to protect:
    // an "is the table empty" guard would put this one back on next launch.
    const seeded = (await invoke<{ id: string }[]>(launched.window, 'skills.list')).find(
      (skill) => skill.id === 'skill-api-design'
    )
    expect(seeded).toBeDefined()
    await invoke(launched.window, 'skills.delete', { id: 'skill-api-design' })

    await launched.app.close()
    launched = await launchApp(profile)
    // Bridge, not shell: this profile hasn't onboarded yet, so the app comes
    // back up on the onboarding screen and there is no sidebar to wait for.
    await waitForBridge(launched.window)

    const after = await invoke<{ id: string; name: string }[]>(launched.window, 'skills.list')
    expect(after.find((skill) => skill.id === created.id)?.name).toBe('Survives Relaunch')
    expect(after.map((skill) => skill.id)).not.toContain('skill-api-design')
  })

  test('refuses to delete a persona a contact is bound to', async () => {
    const persona = await invoke<{ id: string }>(launched.window, 'personas.create', {
      name: 'Bound Persona',
      avatarColor: '#2a78d6',
      backend: 'claude',
      systemPrompt: '',
      skillIds: [],
      sandbox: 'read_only',
      githubScope: 'read_only'
    })

    await invoke(launched.window, 'contacts.create', {
      personaTemplateId: persona.id,
      repoPath: '~/code/e2e-fixture',
      displayName: 'Bound Persona · e2e-fixture'
    })

    // The group is created implicitly by the contact (blueprint §4).
    const groups = await invoke<{ repoPath: string }[]>(launched.window, 'groups.list')
    expect(groups.map((group) => group.repoPath)).toContain('~/code/e2e-fixture')

    await expect(invoke(launched.window, 'personas.delete', { id: persona.id })).rejects.toThrow(
      /still bound/
    )
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
