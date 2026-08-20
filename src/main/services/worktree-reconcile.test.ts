import { execFileSync } from 'child_process'
import { mkdtempSync, realpathSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, expect, describe, it, vi } from 'vitest'
import { createTestDb } from '../db/test-db'
import { toContact } from '../db/mappers'
import { contacts, personaTemplates } from '../db/schema'
import { worktreeAdd } from './git'
import type { AppDatabase } from '../db'
import type { Contact } from '../../shared/domain'

/**
 * Real git plus a real :memory: database, same trade as git-worktree.test.ts:
 * what this function exists for is what git reports about a worktree another
 * process has been mutating, and a mocked `currentBranch` would only prove the
 * code agrees with a guess.
 *
 * The claim under test: a session that creates and checks out its own branch
 * inside its worktree — which nothing prevents — must not leave
 * `contacts.branch` pointing at a name whose checkout has moved away, because
 * the Branches panel, the summary stamps, the PR title, and the Merge button
 * all read that row.
 */

let db: AppDatabase
let scratch: string
let repo: string

vi.mock('electron', () => ({ app: { getPath: (): string => scratch } }))
vi.mock('../db', () => ({ initDb: (): AppDatabase => db }))

const { reconcileWorktreeBranch } = await import('./worktrees')

function run(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

function seedContactRow(overrides: Partial<typeof contacts.$inferInsert>): Contact {
  db.insert(personaTemplates)
    .values({
      id: 'persona-1',
      name: 'Refactor Buddy',
      backend: 'codex',
      systemPrompt: 'refactor',
      skillIds: [],
      sandbox: 'workspace_write',
      githubScope: 'open_pr',
      avatarColor: '#333333'
    })
    .onConflictDoNothing()
    .run()
  db.insert(contacts)
    .values({
      id: 'contact-1',
      personaTemplateId: 'persona-1',
      repoPath: repo,
      displayName: 'Refactor Buddy · my-app',
      backendSessionId: null,
      ...overrides
    })
    .run()
  const row = db.select().from(contacts).where(eq(contacts.id, 'contact-1')).get()
  if (!row) throw new Error('seed failed')
  return toContact(row)
}

function storedBranch(): string | null {
  return db.select().from(contacts).where(eq(contacts.id, 'contact-1')).get()?.branch ?? null
}

beforeEach(() => {
  db = createTestDb()
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'reconcile-')))
  repo = join(scratch, 'my-app')
  execFileSync('git', ['init', '-q', '-b', 'main', repo])
  run(['config', 'user.email', 'test@example.com'], repo)
  run(['config', 'user.name', 'Test'], repo)
  writeFileSync(join(repo, 'a.ts'), 'export const a = 1\n')
  run(['add', '-A'], repo)
  run(['commit', '-m', 'init'], repo)
})

afterEach(() => {
  execFileSync('rm', ['-rf', scratch])
})

describe('reconcileWorktreeBranch', () => {
  it('adopts the branch the session actually moved its worktree to', async () => {
    const worktree = join(scratch, 'wt')
    await worktreeAdd(repo, worktree, 'persona/refactor-buddy-1')
    const contact = seedContactRow({
      isolation: 'worktree',
      worktreePath: worktree,
      branch: 'persona/refactor-buddy-1'
    })

    // What the live run's routine did when told to "fix it on a branch".
    run(['checkout', '-q', '-b', 'fix/readme-typo'], worktree)

    const reconciled = await reconcileWorktreeBranch(contact)

    expect(reconciled.branch).toBe('fix/readme-typo')
    expect(storedBranch()).toBe('fix/readme-typo')
  })

  it('leaves a faithful row alone', async () => {
    const worktree = join(scratch, 'wt')
    await worktreeAdd(repo, worktree, 'persona/refactor-buddy-1')
    const contact = seedContactRow({
      isolation: 'worktree',
      worktreePath: worktree,
      branch: 'persona/refactor-buddy-1'
    })

    const reconciled = await reconcileWorktreeBranch(contact)

    expect(reconciled).toBe(contact)
    expect(storedBranch()).toBe('persona/refactor-buddy-1')
  })

  it('does not touch a contact working in the shared checkout', async () => {
    const contact = seedContactRow({ isolation: 'shared' })

    const reconciled = await reconcileWorktreeBranch(contact)

    expect(reconciled).toBe(contact)
    expect(storedBranch()).toBeNull()
  })

  it('shrugs off a worktree that is gone rather than failing the turn', async () => {
    const contact = seedContactRow({
      isolation: 'worktree',
      worktreePath: join(scratch, 'deleted'),
      branch: 'persona/refactor-buddy-1'
    })

    const reconciled = await reconcileWorktreeBranch(contact)

    expect(reconciled).toBe(contact)
    expect(storedBranch()).toBe('persona/refactor-buddy-1')
  })

  it('keeps the row on a detached HEAD, which is not a branch to adopt', async () => {
    const worktree = join(scratch, 'wt')
    await worktreeAdd(repo, worktree, 'persona/refactor-buddy-1')
    const contact = seedContactRow({
      isolation: 'worktree',
      worktreePath: worktree,
      branch: 'persona/refactor-buddy-1'
    })

    run(['checkout', '-q', '--detach'], worktree)

    const reconciled = await reconcileWorktreeBranch(contact)

    expect(reconciled.branch).toBe('persona/refactor-buddy-1')
    expect(storedBranch()).toBe('persona/refactor-buddy-1')
  })
})
