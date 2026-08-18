/**
 * How much of a GitHub account the repository picker will pull down.
 *
 * In `src/shared/` because both sides need the same number and neither owns
 * it: `github-client.ts` stops paging at it, and the renderer decides from it
 * whether the list it is showing might be short of the account. Two copies of
 * a ceiling is how a UI comes to advertise a cap the fetch no longer has.
 *
 * Ten pages of 100. The figure is a judgement rather than a measurement, and
 * the two directions it can be wrong in are not symmetric: too low and someone
 * genuinely cannot find their repository through this dialog, while too high
 * costs a few hundred milliseconds on the first open of a dialog nobody opens
 * twice. `octokit.paginate` stops as soon as a page comes back short, so this
 * bound only costs anything to an account large enough to need it.
 *
 * The escape hatch is unchanged and predates the cap: bind a local folder.
 * That path involves no API at all, which is why the picker's empty state
 * points at it rather than at a retry.
 */
export const REPO_FETCH_LIMIT = 1000

/**
 * Rows per request. GitHub's maximum for this endpoint, and the largest page is
 * always the cheapest way to reach a given ceiling.
 *
 * REPO_FETCH_LIMIT **must stay a whole number of these**. `octokit.paginate`'s
 * `done()` includes the page it fires on before stopping, so a limit that fell
 * mid-page would quietly hand back more rows than the constant says — and
 * `isPossiblyTruncated`, which compares a length against REPO_FETCH_LIMIT,
 * would then never fire on a genuinely truncated list. Asserted in
 * `github-client.test.ts` rather than trusted.
 */
export const REPO_PAGE_SIZE = 100
