import { describe, expect, it } from 'vitest'
import { describeGitError, describePushError, githubSlug, withToken } from './git'

/**
 * The two places a GitHub token could escape.
 *
 * Worth testing directly rather than through a real clone: the failure mode is
 * silent — a token printed into an error message looks like an error message —
 * and it would reach the renderer, which is where the least trusted code runs.
 */

const TOKEN = 'ghp_supersecrettoken'

describe('withToken', () => {
  it('embeds the token as https userinfo', () => {
    const url = withToken('https://github.com/acme/app.git', TOKEN)
    expect(url).toBe(`https://x-access-token:${TOKEN}@github.com/acme/app.git`)
  })

  // ssh:// and git@ URLs authenticate with a key, and rewriting them would
  // produce something git cannot use.
  it('leaves a non-https URL alone', () => {
    expect(withToken('git@github.com:acme/app.git', TOKEN)).toBe('git@github.com:acme/app.git')
    expect(withToken('ssh://git@github.com/acme/app.git', TOKEN)).toBe(
      'ssh://git@github.com/acme/app.git'
    )
  })

  it('leaves an unparseable URL alone rather than throwing', () => {
    expect(withToken('not a url', TOKEN)).toBe('not a url')
  })
})

describe('describeGitError', () => {
  const SAFE = 'https://github.com/acme/app.git'

  // The reason git's stderr is never passed through: git echoes the remote back
  // on most failures, and by then the remote has a live credential in it.
  it('never repeats stderr, even when stderr contains the token', () => {
    const leaky = `fatal: could not read from 'https://x-access-token:${TOKEN}@github.com/acme/app.git'`

    for (const stderr of [leaky, `${leaky}\nAuthentication failed`, `${leaky}\nnot found`]) {
      const message = describeGitError(stderr, SAFE)
      expect(message).not.toContain(TOKEN)
      expect(message).not.toContain('x-access-token')
    }
  })

  it('names the safe URL so the message is still useful', () => {
    expect(describeGitError('Authentication failed', SAFE)).toContain(SAFE)
  })

  it('explains an auth failure as a token scope problem', () => {
    expect(describeGitError('fatal: Authentication failed', SAFE)).toMatch(/token/i)
  })

  it('explains a missing repo without implying it does not exist', () => {
    expect(describeGitError('remote: Repository not found', SAFE)).toMatch(/private|renamed/i)
  })

  it('explains a network failure as a network failure', () => {
    expect(describeGitError('fatal: could not resolve host: github.com', SAFE)).toMatch(/network/i)
  })

  it('falls back to a generic message for anything unrecognised', () => {
    const message = describeGitError('something entirely new went wrong', SAFE)
    expect(message).toContain(SAFE)
    expect(message).not.toContain('something entirely new')
  })
})

describe('describePushError', () => {
  it('never repeats stderr, even when stderr contains the token', () => {
    const leaky = `remote: error\nfatal: unable to access 'https://x-access-token:${TOKEN}@github.com/acme/app.git/'`

    for (const stderr of [leaky, `${leaky}\nAuthentication failed`, `${leaky}\n! [rejected]`]) {
      const message = describePushError(stderr, 'persona/refactor-buddy-1a2b')
      expect(message).not.toContain(TOKEN)
      expect(message).not.toContain('x-access-token')
    }
  })

  // The one failure a user can actually do something about, and the one where
  // the tempting fix — --force — would throw away a review round.
  it('says a rejected push pushed nothing', () => {
    const message = describePushError('! [rejected] main -> main (non-fast-forward)', 'persona/x')
    expect(message).toMatch(/diverged/i)
    expect(message).toMatch(/nothing was pushed/i)
  })

  it('names the branch rather than the remote, which it must not print', () => {
    expect(describePushError('something new', 'persona/x')).toBe('Pushing persona/x failed.')
  })

  it('reads a permission failure as a token problem', () => {
    expect(describePushError('remote: Permission to acme/app denied', 'persona/x')).toMatch(
      /token/i
    )
  })
})

describe('githubSlug', () => {
  it('reads both URL forms, because both turn up on a real machine', () => {
    // An app clone is https; a repo the user picked off disk is as likely to be
    // an ssh remote they set up years ago.
    expect(githubSlug('https://github.com/acme/app.git')).toEqual({ owner: 'acme', repo: 'app' })
    expect(githubSlug('git@github.com:acme/app.git')).toEqual({ owner: 'acme', repo: 'app' })
    expect(githubSlug('https://github.com/acme/app')).toEqual({ owner: 'acme', repo: 'app' })
  })

  it('strips userinfo, which is where a credential would be', () => {
    expect(githubSlug(`https://x-access-token:${TOKEN}@github.com/acme/app.git`)).toEqual({
      owner: 'acme',
      repo: 'app'
    })
  })

  it('returns null for anything that is not GitHub, rather than guessing', () => {
    // Binding a GitLab checkout is allowed. It simply has no PR path, and the
    // action is hidden rather than failing when clicked.
    expect(githubSlug('https://gitlab.com/acme/app.git')).toBeNull()
    expect(githubSlug('git@gitlab.com:acme/app.git')).toBeNull()
    expect(githubSlug('/Users/me/some/local/repo')).toBeNull()
    expect(githubSlug('')).toBeNull()
    expect(githubSlug('https://github.com/acme')).toBeNull()
  })
})
