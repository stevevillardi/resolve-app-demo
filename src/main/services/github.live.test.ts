import { execFileSync } from 'child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { Octokit } from '@octokit/rest'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createTestDb } from '../db/test-db'
import { personaTemplates } from '../db/schema'
import type { AppDatabase } from '../db/create'
import type { Contact } from '../../shared/domain'

/**
 * The three claims about GitHub that only a real repository can settle: that a
 * pull request appears on GitHub, that a second attempt comments instead of
 * duplicating, and that a dead token says so.
 *
 * **Skipped unless `LIVE_GITHUB=1`**, the same house rule as the other live
 * files — but unlike them this one spends **no model credits**. It commits with
 * git rather than asking a persona to, because what is under test is the remote
 * half: a mocked adapter and a real GitHub are exactly the right combination
 * here. The unattended-routine check, which does need a model, lives in
 * journey3.live.test.ts.
 *
 *   GITHUB_TOKEN=$(gh auth token) GITHUB_LIVE_REPO=owner/repo \
 *     LIVE_GITHUB=1 npx vitest run --project main src/main/services/github.live.test.ts
 *
 * `GITHUB_LIVE_REPO` should be a throwaway repository. This opens real pull
 * requests against it and closes them again on the way out; it never deletes
 * the repository itself, which no token here is scoped to do anyway.
 *
 * The token comes from the environment rather than from `safeStorage`, which
 * needs an Electron main process this file does not have.
 */

const LIVE = process.env.LIVE_GITHUB === '1'
const TOKEN = process.env.GITHUB_TOKEN ?? ''
const SLUG = process.env.GITHUB_LIVE_REPO ?? ''
const [OWNER, REPO_NAME] = SLUG.split('/')

let db: AppDatabase
let scratch: string
let checkout: string
let userData: string
let token: string | null = TOKEN

vi.mock('../db', () => ({ initDb: () => db }))
vi.mock('electron', () => ({ app: { getPath: () => userData } }))
vi.mock('./github-auth', () => ({ getGitHubToken: () => token }))

const { openPullRequest, pullRequestState } = await import('./pull-requests')
const { createContact } = await import('./contacts')
const { ensureWorktree } = await import('./worktrees')
const { cloneRepo } = await import('./git')

const PERSONA = 'persona-live-writer'
const opened: number[] = []
const branches: string[] = []

function git(args: string[], cwd = checkout): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

function commitIn(cwd: string, file: string, contents: string, message: string): void {
  mkdirSync(join(cwd, 'src'), { recursive: true })
  writeFileSync(join(cwd, file), contents)
  git(['add', '-A'], cwd)
  git(['commit', '-m', message], cwd)
}

function api(): Octokit {
  return new Octokit({ auth: TOKEN })
}

beforeAll(async () => {
  if (!LIVE) return
  if (!TOKEN || !SLUG) throw new Error('Set GITHUB_TOKEN and GITHUB_LIVE_REPO to run this.')

  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'pr-live-gh-')))
  userData = join(scratch, 'profile')

  // Through the app's own clone path, so the credential fix is under test here
  // rather than only in the local-remote unit test.
  checkout = await cloneRepo(`https://github.com/${SLUG}.git`, scratch, 'live', TOKEN)
  git(['config', 'user.email', 'live-test@example.com'])
  git(['config', 'user.name', 'Switchboard live test'])

  db = createTestDb()
  db.insert(personaTemplates)
    .values({
      id: PERSONA,
      name: 'Live Writer',
      avatarColor: '#c2410c',
      backend: 'claude',
      systemPrompt: '',
      skillIds: [],
      sandbox: 'workspace_write',
      githubScope: 'open_pr'
    })
    .run()
}, 120_000)

afterAll(async () => {
  if (!LIVE || !scratch) return

  // Close what was opened and delete the branches behind them, so the throwaway
  // repo is reusable rather than accumulating a run's worth of noise each time.
  for (const number of opened) {
    await api()
      .rest.pulls.update({ owner: OWNER, repo: REPO_NAME, pull_number: number, state: 'closed' })
      .catch(() => {})
  }
  for (const branch of branches) {
    try {
      git(['push', `https://x-access-token:${TOKEN}@github.com/${SLUG}.git`, '--delete', branch])
    } catch {
      // Already gone, or never pushed — nothing to clean up.
    }
  }
  execFileSync('rm', ['-rf', scratch])
}, 120_000)

async function writerWithWork(file: string, message: string): Promise<Contact> {
  const contact = createContact({
    personaTemplateId: PERSONA,
    repoPath: checkout,
    displayName: `Live Writer ${Date.now()}`
  })
  await ensureWorktree(contact)
  branches.push(contact.branch as string)
  commitIn(contact.worktreePath as string, file, `export const x = ${Date.now()}\n`, message)
  return contact
}

describe.skipIf(!LIVE)('GitHub remote actions, live', () => {
  it('leaves no credential in the config of a repo it cloned', () => {
    const config = readFileSync(join(checkout, '.git', 'config'), 'utf8')

    expect(existsSync(join(checkout, '.git'))).toBe(true)
    expect(config).not.toContain(TOKEN)
    expect(config).not.toContain('x-access-token')
    expect(config).toContain(`https://github.com/${SLUG}.git`)
  })

  it('opens a real pull request from the persona’s own branch', async () => {
    const contact = await writerWithWork('src/live-a.ts', 'live: first change')

    const result = await openPullRequest(contact.id)
    opened.push(result.number)

    expect(result.action).toBe('created')

    // Asked of GitHub rather than of our own return value, which is the whole
    // point of the check.
    const { data } = await api().rest.pulls.get({
      owner: OWNER,
      repo: REPO_NAME,
      pull_number: result.number
    })

    expect(data.state).toBe('open')
    expect(data.head.ref).toBe(contact.branch)
    expect(data.base.ref).not.toBe(contact.branch)
    expect(data.body).toContain('Switchboard')
  }, 120_000)

  it('comments on the second attempt instead of opening a duplicate', async () => {
    const contact = await writerWithWork('src/live-b.ts', 'live: second change')

    const first = await openPullRequest(contact.id)
    opened.push(first.number)
    expect(first.action).toBe('created')

    commitIn(contact.worktreePath as string, 'src/live-b.ts', 'export const x = 2\n', 'live: again')
    const second = await openPullRequest(contact.id)

    expect(second.action).toBe('commented')
    expect(second.number).toBe(first.number)

    const { data } = await api().rest.issues.listComments({
      owner: OWNER,
      repo: REPO_NAME,
      issue_number: first.number
    })
    expect(data.map((comment) => comment.body).join('\n')).toContain('live: again')
  }, 180_000)

  it('reports a dead token as something the user can fix', async () => {
    const contact = await writerWithWork('src/live-c.ts', 'live: third change')
    token = 'ghp_thistokenisnotrealandneverwas0000000'

    try {
      await expect(openPullRequest(contact.id)).rejects.toThrow(/Reconnect GitHub/)
      // And the read behind the button degrades rather than throwing at the user.
      expect(await pullRequestState(contact.id)).toEqual({ available: true, pr: null })
    } finally {
      token = TOKEN
    }
  }, 120_000)
})
