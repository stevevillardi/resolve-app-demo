import { mkdirSync, mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setGitHubClientFactory, type GitHubClient, type RepoListing } from './github-client'

/**
 * Repo binding (blueprint §9.1), which had no tests until the Octokit client
 * became a port — there was nothing to substitute for a live API call.
 *
 * What is actually this module's own logic is the local half: which of the
 * account's repos is already checked out under the workspace root.
 */

const appState = new Map<string, string>()
let token: string | null = 'gho_test'

vi.mock('electron', () => ({ dialog: { showOpenDialog: vi.fn() } }))
vi.mock('./app-state', () => ({
  getAppState: (key: string) => appState.get(key) ?? null,
  setAppState: (key: string, value: string) => void appState.set(key, value)
}))
vi.mock('./github-auth', () => ({
  getGitHubToken: () => token,
  missingTokenError: (action: string) => new Error(`Connect GitHub first to ${action}.`)
}))

const { listRepos } = await import('./repos')

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
