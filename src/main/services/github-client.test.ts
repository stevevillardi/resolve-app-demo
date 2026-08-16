import { describe, expect, it } from 'vitest'
import { describeGitHubError } from './github-client'

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
