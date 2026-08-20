import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * call()'s token-state side effects need the real state machine observable, so
 * app-state is a Map and octokit is a scriptable double: a request can be made
 * to succeed, to 401, or to fail some other way, and the verdict it leaves
 * behind can then be read directly.
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

/** How many repositories the fake account holds, per test. */
let repoCount = 0
/** Pages the fake paginator actually served, so a test can count requests. */
let pagesServed = 0

/**
 * A stand-in for `octokit.paginate(route, params, mapFn)`.
 *
 * It reproduces the two behaviours `listRepos` leans on, both documented: a
 * short page ends the walk on its own, and `done()` stops *after* the page it
 * was called on is included — which is exactly why `listRepos` slices as well
 * as calling `done()`. The slice is the part under test here, and it exists so
 * the ceiling does not depend on getting the vendor's semantics right.
 */
async function fakePaginate(
  _route: unknown,
  params: { per_page: number },
  mapFn: (response: { data: { id: number; full_name: string }[] }, done: () => void) => unknown[]
): Promise<unknown[]> {
  const out: unknown[] = []
  let stopped = false
  pagesServed = 0

  for (let offset = 0; offset < repoCount && !stopped; offset += params.per_page) {
    const size = Math.min(params.per_page, repoCount - offset)
    const data = Array.from({ length: size }, (_, i) => ({
      id: offset + i,
      full_name: `acme/repo-${offset + i}`,
      name: `repo-${offset + i}`,
      clone_url: `https://github.com/acme/repo-${offset + i}.git`,
      private: false,
      pushed_at: null
    }))
    pagesServed += 1
    out.push(...mapFn({ data }, () => void (stopped = true)))
    if (size < params.per_page) break
  }
  return out
}

vi.mock('@octokit/rest', () => ({
  Octokit: class {
    rest = {
      users: { getAuthenticated: () => getAuthenticatedImpl() },
      repos: { listForAuthenticatedUser: 'GET /user/repos' }
    }
    paginate = fakePaginate
  }
}))

const { describeGitHubError, octokitClient } = await import('./github-client')
const { gitHubTokenState, clearTokenState } = await import('./github-token-state')
const { REPO_FETCH_LIMIT, REPO_PAGE_SIZE } = await import('../../shared/repos')

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

/**
 * The repository picker's ceiling.
 *
 * Asking for one page of 100 and presenting the result as the account tells
 * anyone past a hundred repositories that theirs does not exist. Paging the
 * same endpoint is chosen over GitHub's search API because search has no
 * "repositories I can reach" concept, and lags a freshly created repository by
 * minutes — the reasoning is in `listRepos`.
 *
 * What is worth pinning is not that paging happens but that it *stops*, and
 * stops at a number this app chose rather than one the paginator happened to
 * land on.
 */
describe('listRepos', () => {
  beforeEach(() => {
    repoCount = 0
    pagesServed = 0
  })

  it('returns the whole account when it fits under the ceiling', async () => {
    repoCount = 250
    const repos = await octokitClient('token').listRepos()
    expect(repos).toHaveLength(250)
    expect(repos[0].fullName).toBe('acme/repo-0')
  })

  // The common case, and the reason paging is affordable: a short page ends the
  // walk, so a small account still costs one request rather than ten.
  it('stops after one request for an account smaller than a page', async () => {
    repoCount = 40
    await octokitClient('token').listRepos()
    expect(pagesServed).toBe(1)
  })

  it('caps a very large account at the limit', async () => {
    repoCount = REPO_FETCH_LIMIT * 3
    const repos = await octokitClient('token').listRepos()
    expect(repos).toHaveLength(REPO_FETCH_LIMIT)
    // And it stopped walking rather than reading all three thousand.
    expect(pagesServed).toBe(REPO_FETCH_LIMIT / REPO_PAGE_SIZE)
  })

  /**
   * The invariant that makes the case above exact, stated on its own.
   *
   * `done()` includes the page it fires on before stopping, so the walk lands
   * precisely on REPO_FETCH_LIMIT only while that is a whole number of pages. A
   * limit of 250 would quietly return 300 — and `isPossiblyTruncated` compares
   * a list's length against REPO_FETCH_LIMIT, so it would stop firing and a
   * genuinely truncated list would be presented as the whole account — the
   * exact failure the ceiling exists to prevent, reachable again through a
   * plausible edit to a constant in a different file.
   *
   * This started life as a defensive `.slice()` in `listRepos`.
   * Mutation-checking it showed the slice could not be made to fail — with
   * these two constants it is unreachable — so the guard moved to where the
   * assumption actually lives.
   */
  it('keeps the limit a whole number of pages, which is what makes that exact', () => {
    expect(REPO_FETCH_LIMIT % REPO_PAGE_SIZE).toBe(0)
  })

  // Most-recently-pushed first is the order the picker's ranking assumes for
  // its ties, so paging must not reshuffle it.
  it('keeps GitHub’s order across page boundaries', async () => {
    repoCount = 150
    const repos = await octokitClient('token').listRepos()
    expect(repos.map((repo) => repo.fullName).slice(98, 102)).toEqual([
      'acme/repo-98',
      'acme/repo-99',
      'acme/repo-100',
      'acme/repo-101'
    ])
  })
})
