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
 * The Phase 7 Group layer, through the real preload bridge in a real Electron
 * process.
 *
 * Same rule as messaging.spec.ts: **no turn is started here.** An @mention
 * would spend real API credits against credentials E2E deliberately redirects
 * away from. `groups.mention` is covered against a scripted adapter in
 * src/main/services/messaging.test.ts; what only a packaged, migrated,
 * IPC-served app can prove is that migration 0005 applied, that the new
 * procedures are registered and validated, and that a group's identity survives
 * the round trip.
 */

let launched: LaunchedApp
let profile: string
let repo: string
let groupId: string
let contactId: string

function git(args: string[], cwd: string): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' })
}

test.beforeAll(async () => {
  repo = mkdtempSync(join(tmpdir(), 'switchboard-group-'))
  writeFileSync(join(repo, 'auth.ts'), 'export function signIn(): void {}\n')
  git(['init'], repo)
  git(['-c', 'user.email=e2e@test', '-c', 'user.name=E2E', 'add', '.'], repo)
  git(['-c', 'user.email=e2e@test', '-c', 'user.name=E2E', 'commit', '-m', 'init'], repo)

  profile = createProfile()
  launched = await launchApp(profile)
  await waitForBridge(launched.window)

  const personas = await invoke<{ id: string; name: string }[]>(
    launched.window,
    'personas.list',
    undefined
  )
  const contact = await invoke<{ id: string }>(launched.window, 'contacts.create', {
    personaTemplateId: personas[0].id,
    repoPath: repo,
    displayName: `${personas[0].name} · e2e`
  })
  contactId = contact.id

  const group = await invoke<{ id: string } | null>(launched.window, 'groups.getForRepo', {
    repoPath: repo
  })
  groupId = group!.id
})

test.afterAll(async () => {
  await launched?.app.close()
  destroyProfile(profile)
  rmSync(repo, { recursive: true, force: true })
})

test('a repo resolves to its own group, and an unbound path to none', async () => {
  const { window } = launched

  const group = await invoke<{ id: string; repoPath: string } | null>(window, 'groups.getForRepo', {
    repoPath: repo
  })
  expect(group?.repoPath).toBe(repo)

  // Null rather than an error: a repo nothing is bound to simply has no group.
  await expect(
    invoke(window, 'groups.getForRepo', { repoPath: '/nowhere/at/all' })
  ).resolves.toBeNull()
})

/**
 * This is also the migration check.
 *
 * `groupMessages.list` issues `select()` over every column the Drizzle schema
 * declares, `branch` included. If migration 0005 had not applied to this real
 * on-disk profile, SQLite would answer "no such column: branch" rather than an
 * empty array — so an empty result here proves the column exists. The unit
 * tests build a fresh :memory: database, which cannot catch a migration that
 * fails against an existing profile.
 */
test('a new group has an empty log rather than an error', async () => {
  const { window } = launched

  await expect(invoke(window, 'groupMessages.list', { groupId })).resolves.toEqual([])
  await expect(invoke(window, 'groupMessages.previews', undefined)).resolves.toEqual([])
})

test('the mention procedure validates its input at the boundary', async () => {
  const { window } = launched

  // Empty content is rejected by the contract (content.min(1)), before any
  // lock is taken or any row is written.
  await expect(
    invoke(window, 'groups.mention', { groupId, contactId, content: '' })
  ).rejects.toThrow()

  // And nothing was written by the attempt.
  await expect(invoke(window, 'groupMessages.list', { groupId })).resolves.toEqual([])
})

test('an unknown contact is refused without touching the group', async () => {
  const { window } = launched

  await expect(
    invoke(window, 'groups.mention', { groupId, contactId: 'nobody', content: 'hello' })
  ).rejects.toThrow(/No such contact/)

  await expect(invoke(window, 'groupMessages.list', { groupId })).resolves.toEqual([])
})
