import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * call()'s token-state side effects need the real state machine observable, so
 * app-state is a Map and octokit is a scriptable double. This half of the file
 * landed in Phase 18 — call() previously had no direct coverage at all.
 */
const appStateStore = new Map<string, string>()
vi.mock('./app-state', () => ({
  getAppState: (k: string) => appStateStore.get(k) ?? null,
  setAppState: (k: string, v: string) => void appStateStore.set(k, v),
  deleteAppState: (k: string) => void appStateStore.delete(k)
}))

let getAuthenticatedImpl: () => Promise<{ data: { login: string } }> = async () => ({
  data: { login: 'octocat' }
})
vi.mock('@octokit/rest', () => ({
  Octokit: class {
    rest = {
      users: { getAuthenticated: () => getAuthenticatedImpl() }
    }
  }
}))

const { describeGitHubError, octokitClient } = await import('./github-client')
const { gitHubTokenState, clearTokenState } = await import('./github-token-state')

/**
 * The error translator, which is the half of `github-client.ts` worth testing:
 * the request wiring is a vendor binding, but every one of these strings is UI
 * copy that reaches the user verbatim through `ipcErrorMessage`.
 *
 * A 401 matters most. Nothing in the app revalidates the GitHub token after the
 * device flow — `getGitHubStatus()` reports `connected` from "a string exists in
 * the keychain" — so a token revoked on github.com is only ever discovered here.
 */

/** Octokit throws a RequestError, which carries `status` and optionally a body. */
function githubError(status: number, message: string, errors?: { message: string }[]): Error {
  return Object.assign(new Error(message), {
    status,
    ...(errors ? { response: { data: { errors } } } : {})
  })
}

describe('describeGitHubError', () => {
  it('tells the user to reconnect on 401, whatever GitHub called it', () => {
    const message = describeGitHubError(githubError(401, 'Bad credentials'), 'octocat/hello')

    expect(message).toContain('Reconnect GitHub')
    expect(message).not.toContain('Bad credentials')
  })

  it('separates a rate limit from a permission refusal, both of which are 403', () => {
    expect(describeGitHubError(githubError(403, 'API rate limit exceeded'))).toContain('rate limit')
    expect(describeGitHubError(githubError(403, 'Resource not accessible'), 'octocat/hello')).toBe(
      'GitHub refused the request for octocat/hello. The stored token may not cover it.'
    )
  })

  it('does not claim a 404 means the repo is gone', () => {
    // A missing repo and a token that cannot see it are indistinguishable from
    // the outside, and guessing wrong sends the user to fix the wrong thing.
    const message = describeGitHubError(githubError(404, 'Not Found'), 'octocat/hello')

    expect(message).toContain('octocat/hello')
    expect(message).toContain('token may not cover it')
  })

  it("keeps GitHub's own validation wording on 422, which is better than a paraphrase", () => {
    const message = describeGitHubError(
      githubError(422, 'Validation Failed', [{ message: 'No commits between main and persona/x' }]),
      'octocat/hello'
    )

    expect(message).toContain('No commits between main and persona/x')
  })

  it('recognises a failed connection with no status at all', () => {
    expect(describeGitHubError(new TypeError('fetch failed'))).toBe(
      'Could not reach GitHub. Check the network connection and try again.'
    )
  })

  it('falls back without swallowing an unrecognised failure', () => {
    expect(describeGitHubError(githubError(500, 'Server Error'), 'octocat/hello')).toContain(
      'Server Error'
    )
  })
})

describe('call() and the token verdict', () => {
  beforeEach(() => {
    appStateStore.clear()
    clearTokenState()
    getAuthenticatedImpl = async () => ({ data: { login: 'octocat' } })
  })

  it('marks the token good on any successful request', async () => {
    await octokitClient('gho_x').whoAmI()
    expect(gitHubTokenState()).toBe('good')
  })

  it('marks the token rejected on a 401, and rethrows the human message', async () => {
    getAuthenticatedImpl = async () => {
      throw Object.assign(new Error('Bad credentials'), { status: 401 })
    }

    await expect(octokitClient('gho_x').whoAmI()).rejects.toThrow(/rejected the stored token/i)
    expect(gitHubTokenState()).toBe('rejected')
  })

  it('leaves the verdict alone on a non-auth failure', async () => {
    // A 500 or a network error says nothing about the credential; recording
    // it as rejected would tell the user to reconnect a working token.
    getAuthenticatedImpl = async () => {
      throw Object.assign(new Error('Server Error'), { status: 500 })
    }

    await expect(octokitClient('gho_x').whoAmI()).rejects.toThrow()
    expect(gitHubTokenState()).toBe('unverified')
  })

  it('lets a later success recover from a recorded rejection', async () => {
    getAuthenticatedImpl = async () => {
      throw Object.assign(new Error('Bad credentials'), { status: 401 })
    }
    await expect(octokitClient('gho_x').whoAmI()).rejects.toThrow()

    getAuthenticatedImpl = async () => ({ data: { login: 'octocat' } })
    await octokitClient('gho_new').whoAmI()
    expect(gitHubTokenState()).toBe('good')
  })
})
