import { execFileSync } from 'child_process'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { expect, test } from '@playwright/test'
import {
  createProfile,
  destroyProfile,
  invoke,
  launchApp,
  waitForShell,
  type LaunchedApp
} from './fixtures'

/**
 * The acceptance checks of docs/plan/12-worktree-isolation.md that can be
 * settled without a model: two writers on one repo get separate checkouts, and
 * the Branches panel can see what they leave behind.
 *
 * A turn *is* started here, and it fails — the throwaway profile has no
 * credentials. That is deliberate and it is what makes this free: the worktree
 * is materialised before the adapter is reached, so a turn that dies at the
 * backend still proves the directory, the branch and the git wiring are real.
 * Following the rule the routines spec set, no spec in this suite spends money.
 *
 * ⚠️ To mutation-test these, rebuild with `npx electron-vite build`, not
 * `npm run build`. The latter runs typecheck and the unit suite first, so a
 * mutation worth making fails the gate, the bundle is never rewritten, and the
 * E2E quietly runs the *previous* build and passes. That looks exactly like a
 * test with no teeth — this note exists because it cost an hour to notice.
 */

test.describe.configure({ timeout: 180_000 })

let profile: string
let launched: LaunchedApp
let repo: string
let scratch: string

interface Contact {
  id: string
  displayName: string
  backendSessionId: string | null
  worktreePath: string | null
  branch: string | null
  isolation: string | null
}

interface BranchSummary {
  branch: string
  contactName: string | null
  hasWorktree: boolean
}

function git(args: string[], cwd = repo): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

/** Starts a turn and waits for it to end, however it ends. */
async function runTurnAndSettle(contactId: string): Promise<void> {
  await invoke(launched.window, 'messages.send', { contactId, content: 'hello' }).catch(() => {})
  await expect.poll(() => invoke(launched.window, 'runs.list'), { timeout: 60_000 }).toEqual([])
}

test.beforeAll(async () => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'pr-e2e-wt-')))
  repo = join(scratch, 'my-app')
  execFileSync('git', ['init', '-q', '-b', 'main', repo])
  git(['config', 'user.email', 'test@example.com'])
  git(['config', 'user.name', 'Test'])
  mkdirSync(join(repo, 'src'), { recursive: true })
  writeFileSync(join(repo, 'src/a.ts'), 'export const a = 1\n')
  git(['add', '-A'])
  git(['commit', '-m', 'init'])

  profile = createProfile()
  launched = await launchApp(profile)
  await launched.window.waitForFunction(() => 'api' in window)
})

test.afterAll(async () => {
  await launched?.app.close().catch(() => {})
  destroyProfile(profile)
  execFileSync('rm', ['-rf', scratch])
})

async function bindWriter(displayName: string): Promise<Contact> {
  const personas = await invoke<{ id: string; name: string; sandbox: string }[]>(
    launched.window,
    'personas.list'
  )
  const writer = personas.find((persona) => persona.sandbox === 'workspace_write')
  expect(writer, 'the seed data should include a workspace_write persona').toBeTruthy()

  return invoke<Contact>(launched.window, 'contacts.create', {
    personaTemplateId: writer!.id,
    repoPath: repo,
    displayName
  })
}

test('a writing contact is planned its own checkout and branch', async () => {
  const contact = await bindWriter('Writer One · my-app')

  expect(contact.isolation).toBe('worktree')
  expect(contact.branch).toMatch(/^persona\//)
  // Planned, not yet created — the directory arrives on the first turn.
  expect(contact.worktreePath).toBeTruthy()
  expect(existsSync(contact.worktreePath!)).toBe(false)
})

test('two writers on one repo never share a working directory', async () => {
  const a = await bindWriter('Writer A · my-app')
  const b = await bindWriter('Writer B · my-app')

  expect(a.worktreePath).not.toBe(b.worktreePath)
  expect(a.branch).not.toBe(b.branch)

  await runTurnAndSettle(a.id)
  await runTurnAndSettle(b.id)

  // Both exist at once, which is the thing that stopped them contending — they
  // are not taking turns in one directory, they are in different directories.
  expect(existsSync(a.worktreePath!)).toBe(true)
  expect(existsSync(b.worktreePath!)).toBe(true)

  const worktrees = git(['worktree', 'list', '--porcelain'])
  expect(worktrees).toContain(a.worktreePath)
  expect(worktrees).toContain(b.worktreePath)

  // Neither is the user's own checkout, which is untouched.
  expect(git(['rev-parse', '--abbrev-ref', 'HEAD'])).toBe('main')
  expect(git(['status', '--porcelain'])).toBe('')
})

test('the branch is real in the repo, not merely a string in the database', async () => {
  const contact = await bindWriter('Writer C · my-app')
  await runTurnAndSettle(contact.id)

  expect(git(['rev-parse', '--verify', contact.branch!])).toMatch(/^[0-9a-f]{40}$/)
  expect(git(['rev-parse', '--abbrev-ref', 'HEAD'], contact.worktreePath!)).toBe(contact.branch)
})

test('deleting a contact takes its checkout with it and leaves the branch', async () => {
  const contact = await bindWriter('Writer D · my-app')
  await runTurnAndSettle(contact.id)
  expect(existsSync(contact.worktreePath!)).toBe(true)

  const deleted = await invoke<{ deleted: boolean }>(launched.window, 'contacts.delete', {
    id: contact.id,
    discardUncommitted: true
  })

  expect(deleted.deleted).toBe(true)
  expect(existsSync(contact.worktreePath!)).toBe(false)
  // Committed work is never destroyed by a delete — the branch survives, and
  // the Branches panel is where it gets dealt with.
  expect(git(['rev-parse', '--verify', contact.branch!])).toMatch(/^[0-9a-f]{40}$/)
})

test('renaming a contact leaves its checkout and its session alone', async () => {
  // The unit test in contacts.test.ts asserts the same claim against a
  // :memory: database; this one proves the contract entry, the Zod shapes and
  // the preload round trip agree with it — and that a rename does not disturb
  // the worktree, which only exists on a real filesystem.
  const contact = await bindWriter('Writer F · my-app')
  await runTurnAndSettle(contact.id)

  const before = await invoke<Contact | null>(launched.window, 'contacts.get', { id: contact.id })
  expect(before?.backendSessionId, 'a turn should have left a resume key').toBeTruthy()

  const renamed = await invoke<Contact>(launched.window, 'contacts.update', {
    id: contact.id,
    displayName: 'Renamed Writer'
  })

  expect(renamed).toEqual({ ...before, displayName: 'Renamed Writer' })
  expect(existsSync(contact.worktreePath!)).toBe(true)
  expect(git(['rev-parse', '--verify', contact.branch!])).toMatch(/^[0-9a-f]{40}$/)

  // The branches panel reads the name off the contact, so it has to follow.
  const branches = await invoke<BranchSummary[]>(launched.window, 'branches.list')
  expect(branches.find((entry) => entry.branch === contact.branch)?.contactName).toBe(
    'Renamed Writer'
  )
})

test('the branches panel sees the work, including after its contact is gone', async () => {
  const contact = await bindWriter('Writer E · my-app')
  await runTurnAndSettle(contact.id)

  const before = await invoke<BranchSummary[]>(launched.window, 'branches.list')
  expect(before.find((entry) => entry.branch === contact.branch)?.contactName).toBe(
    'Writer E · my-app'
  )

  await invoke(launched.window, 'contacts.delete', { id: contact.id, discardUncommitted: true })

  const after = await invoke<BranchSummary[]>(launched.window, 'branches.list')
  const orphan = after.find((entry) => entry.branch === contact.branch)
  expect(orphan, 'a branch must outlive the contact that made it').toBeTruthy()
  expect(orphan?.contactName).toBeNull()
  expect(orphan?.hasWorktree).toBe(false)
})

/**
 * The Branches panel and the isolation step are new UI that nothing else in the
 * suite has ever rendered. This is a mount check rather than an interaction
 * test: a component that throws on first render is invisible to every unit test
 * here, since none of them render anything.
 */
test('the branches panel renders and shows the repo’s branches', async () => {
  const contact = await bindWriter('Writer F · my-app')
  await runTurnAndSettle(contact.id)

  await invoke(launched.window, 'auth.completeOnboarding')
  await launched.window.reload()
  await waitForShell(launched.window)

  await launched.window.getByRole('button', { name: 'Branches' }).first().click()

  await expect(launched.window.getByText(contact.branch!, { exact: false }).first()).toBeVisible()

  // And the detail pane mounts with a real branch selected.
  await launched.window.getByText(contact.branch!, { exact: false }).first().click()
  await expect(launched.window.getByRole('button', { name: /^Merge/ })).toBeVisible()
  await expect(launched.window.getByText('Your checkout')).toBeVisible()
})
