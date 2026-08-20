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
  ).rejects.toThrow(/no longer exists/)

  await expect(invoke(window, 'groupMessages.list', { groupId })).resolves.toEqual([])
})

/**
 * Rename and hide, through the real contract (review §G5).
 *
 * Group rows had no menu at all, and there was nothing behind one to call:
 * `groups.*` was four read-ish procedures, none of which wrote anything a user
 * had chosen. `groups.test.ts` proves the service rules against a real
 * database; what belongs here is that the boundary refuses what it says it
 * refuses, since the Zod shape is the only thing standing between a rename
 * dialog and a sidebar row that renders blank.
 */
test('a group can be renamed and put back', async () => {
  const { window } = launched

  const renamed = await invoke<{ name: string | null }>(window, 'groups.rename', {
    id: groupId,
    name: 'Checkout service'
  })
  expect(renamed.name).toBe('Checkout service')

  // Null is the reset, and it is a value the contract accepts rather than an
  // omitted argument — that is what makes "use the repository name" one call.
  const reset = await invoke<{ name: string | null }>(window, 'groups.rename', {
    id: groupId,
    name: null
  })
  expect(reset.name).toBeNull()
})

test('a name of spaces is refused at the boundary, not stored', async () => {
  const { window } = launched

  await expect(invoke(window, 'groups.rename', { id: groupId, name: '   ' })).rejects.toThrow()
  // The refusal wrote nothing: the group still has no name of its own.
  const groups = await invoke<{ id: string; name: string | null }[]>(window, 'groups.list')
  expect(groups.find((group) => group.id === groupId)?.name).toBeNull()
})

test('hiding keeps the group and everything in it', async () => {
  const { window } = launched

  const hidden = await invoke<{ hidden: boolean | null }>(window, 'groups.setHidden', {
    id: groupId,
    hidden: true
  })
  expect(hidden.hidden).toBe(true)

  // Still listed by the procedure — hiding is a property of the row, and it is
  // the conversation list that acts on it. If this returned nothing, unhiding
  // would have nothing to find.
  const groups = await invoke<{ id: string }[]>(window, 'groups.list')
  expect(groups.some((group) => group.id === groupId)).toBe(true)

  // And the contact bound to the repository is untouched, which is the
  // difference between hiding a group and deleting one.
  const contacts = await invoke<{ id: string }[]>(window, 'contacts.list')
  expect(contacts.some((contact) => contact.id === contactId)).toBe(true)

  await invoke(window, 'groups.setHidden', { id: groupId, hidden: false })
})
