import { scoreCommand } from './command-palette'
import type { RepoOption } from '../../../shared/ipc-contract'

/**
 * Filtering the GitHub repository picker.
 *
 * `github-client.ts` justifies fetching a single `per_page: 100` page with the
 * words "this is a picker with a filter box, not an inventory". The filter box
 * did not exist. So the list was capped at 100 *and* unsearchable, in a dialog
 * showing about six rows at a time — for anyone with a real account that is a
 * scroll through a hundred names looking for one.
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
 * `listRepos` asks for one page of 100 with no pagination, so exactly 100 rows
 * is indistinguishable from 100-of-400. Silently showing a truncated list as
 * though it were complete is the failure mode worth naming: someone whose repo
 * is missing needs to know it is a cap, not an absence.
 */
export const REPO_PAGE_SIZE = 100

export function isPossiblyTruncated(repos: RepoOption[]): boolean {
  return repos.length >= REPO_PAGE_SIZE
}
