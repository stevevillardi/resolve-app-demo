import { execFileSync } from 'child_process'
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'fs'
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
 * Acceptance check #2 of docs/plan/09-github-remote-actions.md: a `read_only`
 * persona has no path to any write action anywhere.
 *
 * "Anywhere" is the point, so this asserts it twice — that the Branches panel
 * renders no pull-request action for such a branch, and that the procedure
 * behind that button refuses regardless of what the UI chose to draw. A hidden
 * button is a nicety; the gate is in main.
 *
 * The positive case belongs to the LIVE_GITHUB check rather than here: this
 * profile has no GitHub token by design (see fixtures.ts), so no Contact has a
 * pull-request path and the action is correctly absent for every persona.
 *
 * Which is worth stating plainly rather than leaving to be discovered: the
 * *rendering* assertion below is weak here for exactly that reason — with no
 * token, the action is hidden for every scope, so it would still pass if the
 * scope check were removed. The load-bearing assertions are the two against the
 * procedure, which refuses before it ever looks for a token.
 *
 * ⚠️ To mutation-test these, rebuild with `npx electron-vite build` — see the
 * note at the top of worktrees.spec.ts for why.
 */

test.describe.configure({ timeout: 180_000 })

let profile: string
let launched: LaunchedApp
let repo: string
let scratch: string

interface Contact {
  id: string
  branch: string | null
  worktreePath: string | null
}

interface BranchSummary {
  branch: string
  contactId: string | null
  githubScope: string | null
}

function git(args: string[], cwd = repo): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

async function runTurnAndSettle(contactId: string): Promise<void> {
  await invoke(launched.window, 'messages.send', { contactId, content: 'hello' }).catch(() => {})
  await expect.poll(() => invoke(launched.window, 'runs.list'), { timeout: 60_000 }).toEqual([])
}

test.beforeAll(async () => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'pr-e2e-gh-')))
  repo = join(scratch, 'my-app')
  execFileSync('git', ['init', '-q', '-b', 'main', repo])
  git(['config', 'user.email', 'test@example.com'])
  git(['config', 'user.name', 'Test'])
  mkdirSync(join(repo, 'src'), { recursive: true })
  writeFileSync(join(repo, 'src/a.ts'), 'export const a = 1\n')
  git(['add', '-A'])
  git(['commit', '-m', 'init'])
  // A GitHub remote, so nothing here passes merely because there was nowhere to
  // open a pull request in the first place.
  git(['remote', 'add', 'origin', 'https://github.com/acme/app.git'])

  profile = createProfile()
  launched = await launchApp(profile)
  await launched.window.waitForFunction(() => 'api' in window)
})

test.afterAll(async () => {
  await launched?.app.close().catch(() => {})
  destroyProfile(profile)
  execFileSync('rm', ['-rf', scratch])
})

async function bindPersona(githubScope: string, displayName: string): Promise<Contact> {
  const personas = await invoke<{ id: string; githubScope: string }[]>(
    launched.window,
    'personas.list'
  )
  const persona = personas.find((candidate) => candidate.githubScope === githubScope)
  expect(persona, `the seed data should include a ${githubScope} persona`).toBeTruthy()

  return invoke<Contact>(launched.window, 'contacts.create', {
    personaTemplateId: persona!.id,
    repoPath: repo,
    displayName,
    isolation: 'worktree'
  })
}

test('the service refuses a read_only persona, whatever the UI drew', async () => {
  const contact = await bindPersona('read_only', 'Reviewer · my-app')

  await expect(
    invoke(launched.window, 'github.openPullRequest', { contactId: contact.id })
  ).rejects.toThrow(/read_only GitHub scope/)
})

test('a read_only branch is offered no pull request in the panel', async () => {
  const contact = await bindPersona('read_only', 'Reviewer Two · my-app')
  await runTurnAndSettle(contact.id)

  const branches = await invoke<BranchSummary[]>(launched.window, 'branches.list')
  const summary = branches.find((entry) => entry.contactId === contact.id)
  expect(summary?.githubScope).toBe('read_only')

  await invoke(launched.window, 'auth.completeOnboarding')
  await launched.window.reload()
  await waitForShell(launched.window)

  await launched.window.getByRole('button', { name: 'Branches' }).first().click()
  await launched.window.getByText(contact.branch!, { exact: false }).first().click()

  // The branch is on screen with its own actions — this is not passing because
  // nothing rendered.
  await expect(launched.window.getByRole('button', { name: /^Merge/ })).toBeVisible()
  await expect(launched.window.getByRole('button', { name: /Open PR|Update PR/ })).toHaveCount(0)
})

test('a thread offers no pull request while GitHub is not connected', async () => {
  const contact = await bindPersona('open_pr', 'Writer · my-app')

  const state = await invoke<{ available: boolean }>(launched.window, 'github.pullRequestState', {
    contactId: contact.id
  })
  expect(state.available).toBe(false)

  await expect(
    invoke(launched.window, 'github.openPullRequest', { contactId: contact.id })
  ).rejects.toThrow(/Connect GitHub first/)
})
