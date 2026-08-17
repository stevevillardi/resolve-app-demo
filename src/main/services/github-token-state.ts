import { deleteAppState, getAppState, setAppState } from './app-state'

/**
 * Whether the stored GitHub token still works, as opposed to whether one exists.
 *
 * `getGitHubStatus()` used to answer "connected?" from `existsSync()` on the
 * encrypted token file. It never decrypted the token and never asked GitHub
 * anything, so a token revoked on github.com kept a green dot indefinitely —
 * the app found out only when a feature failed, and the connect dialog hid its
 * Connect button while `connected`, so the only way out was to disconnect
 * first. That is the whole defect this module closes.
 *
 * Three states, and the third is the one that is easy to get wrong:
 *
 * - `good` — GitHub answered a request. The token works.
 * - `rejected` — GitHub answered 401. The token does not work, and this is
 *   **sticky across restarts**: a revoked token is still revoked tomorrow, and
 *   forgetting on relaunch would put the lie straight back.
 * - `unreachable` — we could not ask. A closed laptop lid is not a bad
 *   credential, so this is **never persisted** and never clears `rejected`.
 *   It lives in memory for the current run only.
 *
 * `unverified` is the starting point: a token exists and nothing has used it
 * yet. It reports as connected, because it probably is, and the first request
 * will settle it either way.
 */

export type TokenState = 'unverified' | 'good' | 'rejected' | 'unreachable'

/**
 * Set when a verification attempt fails for a reason that is not GitHub's
 * answer. Deliberately module state rather than a row: it describes this
 * moment, not this token.
 */
let unreachable = false

export function gitHubTokenState(): TokenState {
  const stored = getAppState('github_token_state')
  if (stored === 'rejected') return 'rejected'
  // Ordered so a stored rejection outranks it: being offline does not make a
  // token we already know is dead look merely unreachable.
  if (unreachable) return 'unreachable'
  if (stored === 'good') return 'good'
  return 'unverified'
}

/** GitHub answered. Whatever we thought before, this is now the truth. */
export function markTokenGood(): void {
  unreachable = false
  setAppState('github_token_state', 'good')
}

/** GitHub answered 401. */
export function markTokenRejected(): void {
  unreachable = false
  setAppState('github_token_state', 'rejected')
}

/** We could not ask. Leaves any stored verdict exactly as it was. */
export function markTokenUnreachable(): void {
  unreachable = true
}

/** A new token, or none. Forgets everything known about the old one. */
export function clearTokenState(): void {
  unreachable = false
  deleteAppState('github_token_state')
}
