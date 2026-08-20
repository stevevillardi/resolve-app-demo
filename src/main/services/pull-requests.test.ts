import { execFileSync } from 'child_process'
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestDb } from '../db/test-db'
import { groupMessages, groups, personaTemplates } from '../db/schema'
import { setGitHubClientFactory, type CreatePrInput, type GitHubClient } from './github-client'
import type { AppDatabase } from '../db/create'
import type { Contact, GithubScope } from '../../shared/domain'

/**
 * The gate in front of a pull request.
 *
 * Real git in a temp repo, because every refusal here is a claim about the
 * state of a working copy — uncommitted files, which branch is checked out,
 * whether there are commits to open a PR about — and a mock would only encode a
 * guess about what git reports. GitHub itself is a fake client: the REST calls
 * are a vendor binding, and what is worth testing is which ones get made.
 *
 * `pushBranch` is the one piece stubbed out. It is covered against a real bare
 * repository in git-remote.test.ts; here it would reach github.com.
 */

let db: AppDatabase
let scratch: string
let repo: string
let userData: string
let token: string | null = 'gho_test'

vi.mock('../db', () => ({ initDb: () => db }))
vi.mock('electron', () => ({ app: { getPath: () => userData } }))
vi.mock('./github-auth', () => ({
  getGitHubToken: () => token,
  missingTokenError: (action: string) => new Error(`Connect GitHub first to ${action}.`)
}))

const pushed: { branch: string; url: string; token?: string | null }[] = []
vi.mock('./git', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./git')>()),
  pushBranch: async (_path: string, branch: string, url: string, tok?: string | null) => {
    pushed.push({ branch, url, token: tok })
  }
}))

const { openPullRequest, pullRequestState } = await import('./pull-requests')
const { createContact } = await import('./contacts')
const { ensureWorktree } = await import('./worktrees')

const PERSONA = { open_pr: 'persona-open-pr', read_only: 'persona-read-only' }

// --- The fake GitHub ---------------------------------------------------------

let defaultBranch = 'main'
let canPush = true
let openPr: { number: number; url: string; title: string } | null = null
const created: CreatePrInput[] = []
const comments: { issueNumber: number; body: string }[] = []

function fakeClient(): GitHubClient {
  return {
    whoAmI: async () => ({ login: 'octocat' }),
    listRepos: async () => [],
    getRepo: async () => ({ defaultBranch, canPush }),
    findOpenPr: async () => openPr,
    createPr: async (input) => {
      created.push(input)
      return { number: 7, url: 'https://github.com/acme/app/pull/7', title: input.title }
    },
    comment: async (_o, _r, issueNumber, body) => void comments.push({ issueNumber, body })
  }
}

// --- Fixtures ----------------------------------------------------------------

function run(args: string[], cwd = repo): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

function commitIn(cwd: string, file: string, contents: string, message: string): void {
  mkdirSync(join(cwd, 'src'), { recursive: true })
  writeFileSync(join(cwd, file), contents)
  run(['add', '-A'], cwd)
  run(['commit', '-m', message], cwd)
}

function persona(id: string, name: string, githubScope: GithubScope): void {
  db.insert(personaTemplates)
    .values({
      id,
      name,
      avatarColor: '#c2410c',
      backend: 'claude',
      systemPrompt: '',
      skillIds: [],
      sandbox: 'workspace_write',
      githubScope
    })
    .run()
}

function contactOn(personaTemplateId: string, displayName = 'Refactor Buddy · my-app'): Contact {
  return createContact({ personaTemplateId, repoPath: repo, displayName })
}

/** A worktree Contact whose branch holds one commit of its own. */
async function writerWithWork(personaTemplateId = PERSONA.open_pr): Promise<Contact> {
  const contact = contactOn(personaTemplateId)
  await ensureWorktree(contact)
  commitIn(contact.worktreePath as string, 'src/b.ts', 'export const b = 2\n', 'extract the parser')
  return contact
}

beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'pr-pulls-')))
  userData = join(scratch, 'profile')
  repo = join(scratch, 'my-app')

  execFileSync('git', ['init', '-q', '-b', 'main', repo])
  run(['config', 'user.email', 'test@example.com'])
  run(['config', 'user.name', 'Test'])
  commitIn(repo, 'src/a.ts', 'export const a = 1\n', 'init')
  run(['remote', 'add', 'origin', 'https://github.com/acme/app.git'])

  db = createTestDb()
  persona(PERSONA.open_pr, 'Refactor Buddy', 'open_pr')
  persona(PERSONA.read_only, 'Code Reviewer', 'read_only')

  token = 'gho_test'
  defaultBranch = 'main'
  canPush = true
  openPr = null
  created.length = 0
  comments.length = 0
  pushed.length = 0
  setGitHubClientFactory(fakeClient)
})

afterEach(() => {
  setGitHubClientFactory(null)
  execFileSync('rm', ['-rf', scratch])
})

// --- The gate ----------------------------------------------------------------

describe('openPullRequest', () => {
  it('pushes the branch and opens a pull request against the default branch', async () => {
    const contact = await writerWithWork()

    const result = await openPullRequest(contact.id)

    expect(result).toMatchObject({ action: 'created', number: 7 })
    expect(pushed).toEqual([
      {
        branch: contact.branch,
        url: 'https://github.com/acme/app.git',
        token: 'gho_test'
      }
    ])
    expect(created[0]).toMatchObject({
      owner: 'acme',
      repo: 'app',
      head: contact.branch,
      base: 'main',
      // One commit, so its subject is the title — the persona wrote it about
      // this exact change.
      title: 'extract the parser'
    })
  })

  /**
   * A session told to work on a branch can create and check out one of its own
   * inside its worktree. The PR then opens from that branch (correct — head
   * follows the working copy) while a *title* built from the Contact's
   * registered name still names the old one. Head and title must name the same
   * branch: the one the PR actually ships.
   */
  it('titles the PR after the branch it pushed, not the registered one', async () => {
    const contact = await writerWithWork()
    const worktree = contact.worktreePath as string
    run(['checkout', '-q', '-b', 'fix/readme-typo'], worktree)
    // A second commit, so the fallback title is in play rather than the
    // single-commit subject.
    commitIn(worktree, 'src/c.ts', 'export const c = 3\n', 'another change')

    await openPullRequest(contact.id)

    expect(created[0].head).toBe('fix/readme-typo')
    expect(created[0].title).toContain('fix/readme-typo')
    expect(created[0].title).not.toContain(contact.branch as string)
  })

  // The check that makes githubScope mean something. The button already hides
  // itself; a button is not a permission.
  it('refuses a read_only persona in the service, not just the UI', async () => {
    const contact = await writerWithWork(PERSONA.read_only)

    await expect(openPullRequest(contact.id)).rejects.toThrow(/read_only GitHub scope/)
    expect(pushed).toEqual([])
    expect(created).toEqual([])
  })

  it('refuses to push work that is not committed, and names it', async () => {
    const contact = await writerWithWork()
    writeFileSync(join(contact.worktreePath as string, 'src/c.ts'), 'export const c = 3\n')

    await expect(openPullRequest(contact.id)).rejects.toThrow(/uncommitted change/)
    await expect(openPullRequest(contact.id)).rejects.toThrow(/src\/c\.ts/)
    expect(pushed).toEqual([])
  })

  // Bounded means PR, not push. A Contact working straight in the user's
  // checkout has no branch to raise one from.
  it('refuses when the Contact is working on the default branch itself', async () => {
    // `exclusive` is the isolation that deliberately runs in the main tree.
    const contact = createContact({
      personaTemplateId: PERSONA.open_pr,
      repoPath: repo,
      displayName: 'Buddy · main tree',
      isolation: 'exclusive'
    })
    commitIn(repo, 'src/d.ts', 'export const d = 4\n', 'user work')

    await expect(openPullRequest(contact.id)).rejects.toThrow(/works directly on main/)
    expect(pushed).toEqual([])
  })

  it('refuses when the branch is not ahead of the default branch', async () => {
    const contact = contactOn(PERSONA.open_pr)
    await ensureWorktree(contact)

    await expect(openPullRequest(contact.id)).rejects.toThrow(/no commits/)
    expect(pushed).toEqual([])
  })

  it('refuses when the token cannot push to the repository', async () => {
    canPush = false
    const contact = await writerWithWork()

    await expect(openPullRequest(contact.id)).rejects.toThrow(/cannot push to acme\/app/)
  })

  it('refuses before GitHub is connected', async () => {
    token = null
    const contact = await writerWithWork()

    await expect(openPullRequest(contact.id)).rejects.toThrow(/Connect GitHub first/)
  })

  it('refuses for a Contact bound to a folder that is not a repository', async () => {
    const plain = join(scratch, 'notes')
    mkdirSync(plain)
    const contact = createContact({
      personaTemplateId: PERSONA.open_pr,
      repoPath: plain,
      displayName: 'Buddy · notes',
      isolation: 'exclusive'
    })

    await expect(openPullRequest(contact.id)).rejects.toThrow(/not a git repository/)
  })

  it('refuses when the repository has no GitHub remote', async () => {
    run(['remote', 'set-url', 'origin', 'https://gitlab.com/acme/app.git'])
    const contact = await writerWithWork()

    await expect(openPullRequest(contact.id)).rejects.toThrow(/no GitHub remote/)
  })

  // The case that makes the action usable more than once: a second createPr
  // would fail with GitHub's own 422, and a duplicate PR would be worse.
  it('comments on the pull request that is already open instead of opening another', async () => {
    const contact = await writerWithWork()
    openPr = { number: 7, url: 'https://github.com/acme/app/pull/7', title: 'extract the parser' }

    commitIn(contact.worktreePath as string, 'src/e.ts', 'export const e = 5\n', 'address review')
    const result = await openPullRequest(contact.id)

    expect(result).toMatchObject({ action: 'commented', number: 7 })
    expect(created).toEqual([])
    expect(comments[0].issueNumber).toBe(7)
    expect(comments[0].body).toContain('address review')
    // Still pushed: the new commits are the reason there is anything to say.
    expect(pushed).toHaveLength(1)
  })

  it("quotes the persona's own end-of-session summary in the body", async () => {
    const contact = await writerWithWork()
    // createContact already made the repo's Group — one Group per repository.
    const group = db.select().from(groups).get()
    db.insert(groupMessages)
      .values({
        id: 'gm1',
        groupId: group?.id as string,
        timestamp: new Date(),
        type: 'system_summary',
        contactId: contact.id,
        content: 'Extracted the parser so the tokenizer can be tested on its own.',
        category: 'decision',
        durable: true,
        branch: contact.branch
      })
      .run()

    await openPullRequest(contact.id)

    expect(created[0].body).toContain('Extracted the parser')
    expect(created[0].body).toContain('Refactor Buddy')
    expect(created[0].body).toContain('sandbox: workspace_write')
  })
})

describe('pullRequestState', () => {
  it('offers the action for a Contact that has a branch and a GitHub remote', async () => {
    const contact = await writerWithWork()

    expect(await pullRequestState(contact.id)).toEqual({ available: true, pr: null })
  })

  it('reports the open pull request when there is one', async () => {
    const contact = await writerWithWork()
    openPr = { number: 7, url: 'https://github.com/acme/app/pull/7', title: 'extract the parser' }

    expect(await pullRequestState(contact.id)).toEqual({ available: true, pr: openPr })
  })

  // Hidden, not disabled: a read_only persona has no write action anywhere.
  it('offers nothing to a read_only persona', async () => {
    const contact = await writerWithWork(PERSONA.read_only)

    expect(await pullRequestState(contact.id)).toEqual({ available: false, pr: null })
  })

  it('offers nothing when GitHub is not connected, and never throws', async () => {
    token = null
    const contact = await writerWithWork()

    expect(await pullRequestState(contact.id)).toEqual({ available: false, pr: null })
  })
})
