import { scoreCommand } from './command-palette'
import { REPO_FETCH_LIMIT } from '../../../shared/repos'
import type { RepoOption } from '../../../shared/ipc-contract'

/**
 * Filtering the GitHub repository picker.
 *
 * `github-client.ts` once justified fetching a single `per_page: 100` page with
 * the words "this is a picker with a filter box, not an inventory". The filter
 * box did not exist. So the list was capped at 100 *and* unsearchable, in a
 * dialog showing about six rows at a time — for anyone with a real account that
 * is a scroll through a hundred names looking for one. This file was the first
 * half of the answer; the picker's paging — its "load more" through the
 * account's repositories — is the second, and the two are meant to be read
 * together: fetch enough that the list is the account, then rank it so the size
 * stops mattering.
 *
 * Ranking is `scoreCommand`'s rather than a second implementation of the same
 * idea. It already splits on `/`, which is exactly what a repo full name needs:
 * typing `router` finds `stevevillardi/persona-router` by word start rather
 * than only by substring, and typing an owner finds everything they own.
 */
export function filterRepos(repos: RepoOption[], query: string): RepoOption[] {
  const needle = query.trim()
  if (!needle) return repos

  return (
    repos
      .map((repo, index) => ({
        repo,
        index,
        score: scoreCommand({ id: repo.id, group: 'Conversations', label: repo.fullName }, needle)
      }))
      .filter((entry) => entry.score > 0)
      // Ties keep GitHub's order, which is by last push — so an exact-tier tie
      // between two repos puts the one you touched this morning first. Sorting
      // alphabetically here would throw that away.
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .map((entry) => entry.repo)
  )
}

/**
 * Whether the list we are showing might not be the whole account.
 *
 * The check outlives the cap it was written against and is now far less likely
 * to fire, but the failure mode is unchanged: a list of exactly
 * REPO_FETCH_LIMIT rows is indistinguishable from the first REPO_FETCH_LIMIT of
 * more, and presenting a truncated list as complete tells someone their
 * repository does not exist when it is merely past the end. The number moved,
 * and it is read from `src/shared` rather than restated here, so the sentence
 * the UI prints cannot outlive the fetch that justified it.
 */
export function isPossiblyTruncated(repos: RepoOption[]): boolean {
  return repos.length >= REPO_FETCH_LIMIT
}
