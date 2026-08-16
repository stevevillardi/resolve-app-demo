import { test, expect } from '@playwright/test'
import { execFileSync } from 'child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  createProfile,
  destroyProfile,
  invoke,
  launchApp,
  waitForBridge,
  type LaunchedApp
} from './fixtures'

/**
 * The Phase 6 wiring, driven through the real preload bridge in a real Electron
 * process.
 *
 * What is deliberately *not* here: sending a message. That would spend real API
 * credits and depend on live credentials, which E2E redirects away from on
 * purpose (see fixtures.ts). The turn loop itself is covered by
 * src/main/services/messaging.test.ts against a scripted adapter; this covers
 * the parts that only a packaged, migrated, IPC-served app can prove — that the
 * procedures exist, that a contact binds to a real path on disk, and that the
 * Group appears with it.
 */

let launched: LaunchedApp
let profile: string
let repo: string

function git(args: string[], cwd: string): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' })
}

test.beforeAll(async () => {
  // A real git repo, so `isGitRepo` has something true to answer about.
  repo = mkdtempSync(join(tmpdir(), 'persona-router-repo-'))
  writeFileSync(join(repo, 'auth.ts'), 'export function signIn(): void {}\n')
  git(['init'], repo)
  git(['-c', 'user.email=e2e@test', '-c', 'user.name=E2E', 'add', '.'], repo)
  git(['-c', 'user.email=e2e@test', '-c', 'user.name=E2E', 'commit', '-m', 'init'], repo)

  profile = createProfile()
  launched = await launchApp(profile)
  await waitForBridge(launched.window)
})

test.afterAll(async () => {
  await launched?.app.close()
  destroyProfile(profile)
  rmSync(repo, { recursive: true, force: true })
})

test('the messaging procedures are served', async () => {
  const { window } = launched

  // A fresh profile has no contacts, so these are all empty rather than absent.
  await expect(invoke(window, 'messages.previews', undefined)).resolves.toEqual([])
  await expect(invoke(window, 'runs.list', undefined)).resolves.toEqual([])
  await expect(invoke(window, 'usage.list', {})).resolves.toEqual([])
})

test('model lists come from main, per backend', async () => {
  const { window } = launched

  const claude = await invoke<string[]>(window, 'models.listForBackend', { backend: 'claude' })
  const codex = await invoke<string[]>(window, 'models.listForBackend', { backend: 'codex' })

  expect(claude.length).toBeGreaterThan(0)
  expect(codex.length).toBeGreaterThan(0)
  // The lists must not overlap: a model that appears under both backends would
  // mean the editor could carry a choice across a backend switch.
  expect(claude.filter((model) => codex.includes(model))).toEqual([])
})

test('binding a contact to a real repo creates its group', async () => {
  const { window } = launched

  const personas = await invoke<{ id: string; name: string }[]>(window, 'personas.list', undefined)
  expect(personas.length).toBeGreaterThan(0)

  const contact = await invoke<{ id: string; repoPath: string; backendSessionId: string | null }>(
    window,
    'contacts.create',
    {
      personaTemplateId: personas[0].id,
      repoPath: repo,
      displayName: `${personas[0].name} · e2e`
    }
  )

  expect(contact.repoPath).toBe(repo)
  // Null until a turn actually runs — the adapters fill it in mid-stream.
  expect(contact.backendSessionId).toBeNull()

  // Blueprint §4: one Group per repo, created in the same transaction.
  const groups = await invoke<{ repoPath: string }[]>(window, 'groups.list', undefined)
  expect(groups.map((group) => group.repoPath)).toContain(repo)

  // A contact that has never run has an empty thread rather than an error.
  await expect(invoke(window, 'messages.list', { contactId: contact.id })).resolves.toEqual([])
})

test('a persona can be pointed at a specific model and it persists', async () => {
  const { window } = launched

  const [persona] = await invoke<
    { id: string; backend: 'claude' | 'codex'; model: string | null }[]
  >(window, 'personas.list', undefined)
  const models = await invoke<string[]>(window, 'models.listForBackend', {
    backend: persona.backend
  })

  await invoke(window, 'personas.update', { ...persona, model: models[0] })

  const reloaded = await invoke<{ id: string; model: string | null }[]>(
    window,
    'personas.list',
    undefined
  )
  expect(reloaded.find((candidate) => candidate.id === persona.id)?.model).toBe(models[0])
})

test('cancelling a run that does not exist is reported, not thrown', async () => {
  const { window } = launched
  await expect(invoke(window, 'messages.cancel', { runId: 'nope' })).resolves.toEqual({
    cancelled: false
  })
})
