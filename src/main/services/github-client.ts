import { Octokit } from '@octokit/rest'
import { REPO_FETCH_LIMIT, REPO_PAGE_SIZE } from '../../shared/repos'
import { markTokenGood, markTokenRejected } from './github-token-state'

/**
 * The GitHub REST surface this app uses, as a port.
 *
 * Kept apart from the services that call it for the same reason `cron-engine.ts`
 * is kept apart from `scheduler.ts`: the policy is worth testing and the vendor
 * binding is not, so the binding is the thin half. It is also what makes
 * `repos.ts` testable at all — with `Octokit` constructed inline in the calling
 * service, there is nothing to substitute for a live API call.
 *
 * It is also the single place a GitHub status code is read. Every call the app
 * makes can fail with a token that was revoked on github.com since the device
 * flow ran — nothing revalidates it, and `getGitHubStatus()` reports `connected`
 * from "a string exists in the keychain" — so a 401 has to say so wherever it
 * lands, rather than surfacing as Octokit's own wording.
 */

export interface RepoInfo {
  defaultBranch: string
  /** Whether the token's user can push. A PR still needs it: the head branch is pushed first. */
  canPush: boolean
}

export interface PrRef {
  number: number
  url: string
  title: string
}

export interface CreatePrInput {
  owner: string
  repo: string
  /** Branch the work is on. Same-owner only — this app never opens cross-fork PRs. */
  head: string
  base: string
  title: string
  body: string
}

export interface RepoListing {
  id: string
  fullName: string
  name: string
  cloneUrl: string
  private: boolean
  pushedAt: number | null
}

export interface GitHubClient {
  /**
   * The cheapest authenticated call GitHub offers, used to find out whether the
   * stored token still works. On the port rather than as a bare `new Octokit`
   * so a test can make it fail — which is the only way the "offline is not
   * rejected" branch can be asserted at all.
   */
  whoAmI(): Promise<{ login: string }>
  listRepos(): Promise<RepoListing[]>
  getRepo(owner: string, repo: string): Promise<RepoInfo>
  findOpenPr(owner: string, repo: string, head: string): Promise<PrRef | null>
  createPr(input: CreatePrInput): Promise<PrRef>
  comment(owner: string, repo: string, issueNumber: number, body: string): Promise<void>
}

type ClientFactory = (token: string) => GitHubClient

let factory: ClientFactory = octokitClient

/** Tests substitute the whole client here; nothing else may call it. */
export function setGitHubClientFactory(next: ClientFactory | null): void {
  factory = next ?? octokitClient
}

export function gitHubClient(token: string): GitHubClient {
  return factory(token)
}

/**
 * The real client, and the only `new Octokit` in the app.
 *
 * The device flow's `users.getAuthenticated()` goes through here too, even
 * though that call happens before the token is stored: the factory takes the
 * token as an argument, so it needs no instance of its own — and keeping it
 * outside the port would leave the one call that can tell us whether a token
 * works as the one call no test can substitute.
 */
export function octokitClient(token: string): GitHubClient {
  const octokit = new Octokit({ auth: token })

  return {
    async whoAmI() {
      const { data } = await call(() => octokit.rest.users.getAuthenticated())
      return { login: data.login }
    },

    async listRepos() {
      /**
       * Sorted by push rather than by name, because the repo you want to bind
       * is almost always one you touched recently.
       *
       * Paged rather than searched. GitHub's search endpoint is the obvious
       * answer to "the picker only sees 100" and the wrong one here:
       * `/search/repositories` has no notion of "repositories I can reach", so
       * it needs the viewer's login *and* every org they belong to spliced into
       * the query as qualifiers — an extra API call to build, stale the moment
       * someone joins an org, and silently returning all of public GitHub if a
       * qualifier is ever dropped. It also reads an index that lags a freshly
       * created repository by minutes, which is precisely when someone is
       * trying to bind one.
       *
       * Paging the same endpoint keeps the affiliation filter that already
       * makes this list *correct*, and turns the cap from a question about
       * which repositories are reachable back into one about how many. The
       * local filter box then ranks everything the account can see.
       *
       * `octokit.paginate` stops on its own when a page comes back short, so
       * an account with 40 repositories still costs one request rather than
       * REPO_FETCH_LIMIT / REPO_PAGE_SIZE of them.
       *
       * `done()` includes the page it fires on and then stops, so the walk ends
       * exactly on REPO_FETCH_LIMIT only because that is a whole number of
       * pages. That is an invariant rather than a coincidence, and
       * `github-client.test.ts` asserts it — the alternative was a defensive
       * `.slice()` here, which turned out to be unreachable code that no test
       * could ever fail on.
       */
      let fetched = 0
      const data = await call(() =>
        octokit.paginate(
          octokit.rest.repos.listForAuthenticatedUser,
          {
            sort: 'pushed',
            direction: 'desc',
            per_page: REPO_PAGE_SIZE,
            affiliation: 'owner,collaborator,organization_member'
          },
          (response, done) => {
            fetched += response.data.length
            if (fetched >= REPO_FETCH_LIMIT) done()
            return response.data
          }
        )
      )

      return data.map((repo) => ({
        id: String(repo.id),
        fullName: repo.full_name,
        name: repo.name,
        cloneUrl: repo.clone_url ?? `https://github.com/${repo.full_name}.git`,
        private: repo.private,
        pushedAt: repo.pushed_at ? new Date(repo.pushed_at).getTime() : null
      }))
    },

    async getRepo(owner, repo) {
      const { data } = await call(() => octokit.rest.repos.get({ owner, repo }), `${owner}/${repo}`)
      return {
        defaultBranch: data.default_branch,
        canPush: data.permissions?.push ?? false
      }
    },

    async findOpenPr(owner, repo, head) {
      // `head` must be qualified with the owner of the branch, which for this
      // app is always the repo's own owner — no fork flow exists.
      const { data } = await call(
        () => octokit.rest.pulls.list({ owner, repo, state: 'open', head: `${owner}:${head}` }),
        `${owner}/${repo}`
      )

      const pr = data[0]
      return pr ? { number: pr.number, url: pr.html_url, title: pr.title } : null
    },

    async createPr({ owner, repo, head, base, title, body }) {
      const { data } = await call(
        () => octokit.rest.pulls.create({ owner, repo, head, base, title, body }),
        `${owner}/${repo}`
      )
      return { number: data.number, url: data.html_url, title: data.title }
    },

    async comment(owner, repo, issueNumber, body) {
      // Pull requests are issues as far as comments are concerned; this endpoint
      // is what posts a conversation comment rather than a review.
      await call(
        () => octokit.rest.issues.createComment({ owner, repo, issue_number: issueNumber, body }),
        `${owner}/${repo}`
      )
    }
  }
}

/**
 * Runs one request and translates whatever it throws into something a user can
 * act on.
 *
 * The messages name the *remedy* rather than the status code, because every one
 * of these reaches the UI verbatim — services throw plain `Error`s and the
 * renderer strips Electron's wrapper and renders the message (`ipcErrorMessage`).
 */
async function call<T>(request: () => Promise<T>, subject?: string): Promise<T> {
  try {
    const result = await request()
    // Every successful call is evidence the token works, so the status dot can
    // recover on its own — reconnecting is not the only way back out of
    // `rejected`.
    markTokenGood()
    return result
  } catch (error) {
    // The status code is read here and nowhere else, and it is discarded on the
    // way out: services rethrow a plain Error carrying only the human message,
    // so nothing downstream could key off a 401 even if it wanted to. Recording
    // it *now* is what lets the sidebar stop claiming connected.
    const status = (error as { status?: number } | null)?.status
    if (status === 401) markTokenRejected()
    throw new Error(describeGitHubError(error, subject))
  }
}

export function describeGitHubError(error: unknown, subject?: string): string {
  const status = (error as { status?: number } | null)?.status
  const message = error instanceof Error ? error.message : String(error)
  const what = subject ?? 'GitHub'

  if (status === 401) {
    return 'GitHub rejected the stored token. Reconnect GitHub from the sidebar and try again.'
  }
  if (status === 403) {
    if (/rate limit/i.test(message)) {
      return 'GitHub’s rate limit has been reached. Try again in a few minutes.'
    }
    return `GitHub refused the request for ${what}. The stored token may not cover it.`
  }
  if (status === 404) {
    return `${what} was not found. It may be private, renamed, or deleted, or the token may not cover it.`
  }
  if (status === 422) {
    // GitHub's own validation wording is better than anything paraphrased here
    // ("No commits between main and …", "A pull request already exists"), and
    // carries no credential.
    return `GitHub refused the request for ${what}: ${detailOf(error) ?? message}`
  }
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|network/i.test(message)) {
    return 'Could not reach GitHub. Check the network connection and try again.'
  }

  return `GitHub request for ${what} failed: ${message}`
}

function detailOf(error: unknown): string | null {
  const errors = (error as { response?: { data?: { errors?: { message?: string }[] } } } | null)
    ?.response?.data?.errors
  const first = errors?.map((entry) => entry.message).filter(Boolean)[0]
  return first ?? null
}
