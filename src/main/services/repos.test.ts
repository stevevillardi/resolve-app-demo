import { mkdirSync, mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestDb } from '../db/test-db'
import { auditEvents } from '../db/schema'
import { setGitHubClientFactory, type GitHubClient, type RepoListing } from './github-client'
import type { AppDatabase } from '../db/create'

/**
 * Repo binding, driven through the Octokit port: the client is substitutable,
 * so the account's listing is scripted here rather than fetched.
 *
 * What is actually this module's own logic is the local half — which of the
 * account's repos is already checked out under the workspace root — and that is
 * what these pin.
 */

const appState = new Map<string, string>()
let token: string | null = 'gho_test'
let db: AppDatabase

vi.mock('electron', () => ({ dialog: { showOpenDialog: vi.fn() } }))
vi.mock('../db', () => ({ initDb: (): AppDatabase => db }))
// agent-events imports electron's BrowserWindow, which the mock above has no
// reason to provide.
vi.mock('./agent-events', () => ({ emitAuditChanged: (): void => {} }))
vi.mock('./app-state', () => ({
  getAppState: (key: string) => appState.get(key) ?? null,
  setAppState: (key: string, value: string) => void appState.set(key, value)
}))
vi.mock('./github-auth', () => ({
  getGitHubToken: () => token,
  missingTokenError: (action: string) => new Error(`Connect GitHub first to ${action}.`)
}))

let clonedTo: string | null = null
vi.mock('./git', () => ({
  cloneRepo: async (_url: string, parentDirectory: string, name: string) => {
    clonedTo = join(parentDirectory, name)
    return clonedTo
  },
  isGitRepo: async () => true
}))

const { cloneToWorkspace, listRepos } = await import('./repos')

function listing(overrides: Partial<RepoListing> = {}): RepoListing {
  return {
    id: '1',
    fullName: 'stevevillardi/persona-router',
    name: 'persona-router',
    cloneUrl: 'https://github.com/stevevillardi/persona-router.git',
    private: true,
    pushedAt: 1_700_000_000_000,
    ...overrides
  }
}

function fakeClient(repos: RepoListing[]): GitHubClient {
  return {
    whoAmI: async () => ({ login: 'octocat' }),
    listRepos: async () => repos,
    getRepo: async () => ({ defaultBranch: 'main', canPush: true }),
    findOpenPr: async () => null,
    createPr: async () => ({ number: 1, url: 'https://github.com/x/y/pull/1', title: 't' }),
    comment: async () => {}
  }
}

beforeEach(() => {
  appState.clear()
  token = 'gho_test'
  clonedTo = null
  db = createTestDb()
})

afterEach(() => setGitHubClientFactory(null))

describe('listRepos', () => {
  it('refuses before GitHub is connected rather than returning an empty list', async () => {
    token = null
    await expect(listRepos()).rejects.toThrow(/Connect GitHub first/)
  })

  it('marks a repo already cloned under the workspace root, and only that one', async () => {
    const root = mkdtempSync(join(tmpdir(), 'repos-test-'))
    mkdirSync(join(root, 'persona-router'))
    appState.set('workspace_root', root)

    setGitHubClientFactory(() =>
      fakeClient([listing(), listing({ id: '2', name: 'elsewhere', fullName: 'me/elsewhere' })])
    )

    const [cloned, notCloned] = await listRepos()

    expect(cloned.localPath).toBe(join(root, 'persona-router'))
    expect(notCloned.localPath).toBeNull()
  })

  it('reports nothing as local when no workspace root has been chosen yet', async () => {
    setGitHubClientFactory(() => fakeClient([listing()]))

    const [repo] = await listRepos()

    expect(repo.localPath).toBeNull()
    expect(repo.fullName).toBe('stevevillardi/persona-router')
  })

  it('treats a workspace root that no longer exists as unset', async () => {
    // A remembered directory can be deleted or live on an unmounted volume.
    appState.set('workspace_root', join(tmpdir(), 'definitely-not-here-9f3a'))
    setGitHubClientFactory(() => fakeClient([listing()]))

    const [repo] = await listRepos()

    expect(repo.localPath).toBeNull()
  })
})

describe('cloneToWorkspace', () => {
  it('records a repo_cloned audit event, with no Contact to attribute it to yet', async () => {
    const root = mkdtempSync(join(tmpdir(), 'repos-test-'))
    appState.set('workspace_root', root)

    const bound = await cloneToWorkspace(
      'stevevillardi/persona-router',
      'https://example.com/x.git'
    )

    expect(bound?.path).toBe(clonedTo)

    const [row] = db.select().from(auditEvents).all()
    expect(row.action).toBe('repo_cloned')
    expect(row.contactId).toBeNull()
    expect(row.repoPath).toBe(clonedTo)
  })
})
