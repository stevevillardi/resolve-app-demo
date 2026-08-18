import { describe, expect, it } from 'vitest'
import { filterRepos, isPossiblyTruncated } from './repo-filter'
import { REPO_FETCH_LIMIT } from '../../../shared/repos'
import type { RepoOption } from '../../../shared/ipc-contract'

function repo(fullName: string, localPath: string | null = null): RepoOption {
  return {
    id: fullName,
    fullName,
    cloneUrl: `https://github.com/${fullName}.git`,
    private: false,
    updatedAt: null,
    localPath
  }
}

// Deliberately in "most recently pushed" order, the order GitHub returns and
// the order the picker relies on for ties.
const REPOS = [
  repo('stevevillardi/persona-router'),
  repo('stevevillardi/billing-api'),
  repo('acme/router-config'),
  repo('acme/checkout-service')
]

describe('filterRepos', () => {
  it('returns everything for an empty or blank query', () => {
    expect(filterRepos(REPOS, '')).toEqual(REPOS)
    expect(filterRepos(REPOS, '   ')).toEqual(REPOS)
  })

  it('finds a repo by the name half, not just the owner prefix', () => {
    // The point of reusing scoreCommand: it splits on `/`, so the part people
    // actually think of the repo as is a word start rather than a substring
    // buried after the owner.
    expect(filterRepos(REPOS, 'billing').map((r) => r.fullName)).toEqual([
      'stevevillardi/billing-api'
    ])
  })

  it('finds every repo an owner has', () => {
    expect(filterRepos(REPOS, 'acme').map((r) => r.fullName)).toEqual([
      'acme/router-config',
      'acme/checkout-service'
    ])
  })

  it('ranks a full-name prefix above a word match further in', () => {
    // Note what this is *not* asserting. `scoreCommand` splits on hyphens as
    // well as slashes, so `acme/router-config` and `stevevillardi/persona-router`
    // both score as word-start matches for "router" and tie — the first draft of
    // this test assumed otherwise and was wrong about the ranking, not about the
    // code. The tier that genuinely separates them is a prefix on the whole name.
    const repos = [repo('stevevillardi/billing-api'), repo('billing/tools')]
    expect(filterRepos(repos, 'billing').map((r) => r.fullName)).toEqual([
      'billing/tools',
      'stevevillardi/billing-api'
    ])
  })

  it('treats a hyphenated segment as a word, so both halves are findable', () => {
    expect(filterRepos(REPOS, 'config').map((r) => r.fullName)).toEqual(['acme/router-config'])
  })

  it('keeps GitHub’s push order between equally good matches', () => {
    const tied = [repo('a/service-one'), repo('b/service-two')]
    expect(filterRepos(tied, 'service').map((r) => r.fullName)).toEqual([
      'a/service-one',
      'b/service-two'
    ])
  })

  it('is case-insensitive', () => {
    expect(filterRepos(REPOS, 'BILLING')).toHaveLength(1)
  })

  it('returns nothing rather than everything when nothing matches', () => {
    // The failure worth guarding: a filter that falls back to the full list on
    // no match looks like it is ignoring what you typed.
    expect(filterRepos(REPOS, 'zzzz')).toEqual([])
  })
})

describe('isPossiblyTruncated', () => {
  it('is false for a list that fits inside one page', () => {
    expect(isPossiblyTruncated(REPOS)).toBe(false)
  })

  it('is true at exactly the fetch limit, because that is indistinguishable from more', () => {
    const full = Array.from({ length: REPO_FETCH_LIMIT }, (_, i) => repo(`acme/repo-${i}`))
    expect(isPossiblyTruncated(full)).toBe(true)
  })
})
