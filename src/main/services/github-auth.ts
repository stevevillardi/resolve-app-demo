import { createOAuthDeviceAuth } from '@octokit/auth-oauth-device'
import type { DeviceFlowState, GitHubAuthStatus } from '../../shared/ipc-contract'
import { deleteAppState, getAppState, setAppState } from './app-state'
import { gitHubClient } from './github-client'
import { clearTokenState, gitHubTokenState, markTokenUnreachable } from './github-token-state'
import {
  deleteSecret,
  getSecret,
  hasSecret,
  isSecretStorageAvailable,
  secretUnreadable,
  setSecret
} from './secrets'

/**
 * GitHub OAuth Device Flow (blueprint §9). No local redirect server, no client
 * secret — the client ID is build-time config, not a credential.
 *
 * This phase only acquires and stores the token. Repo listing is Phase 6 and
 * push/PR is Phase 9; both read the token back via getGitHubToken().
 */

const DEFAULT_SCOPES = ['repo', 'read:user']

// Both spellings are accepted (see envPrefix in electron.vite.config.ts):
// MAIN_VITE_* is the canonical electron-vite form, the bare name is what a
// GitHub OAuth App's docs hand you.
function clientId(): string | null {
  const id = (
    import.meta.env.MAIN_VITE_GITHUB_CLIENT_ID ??
    import.meta.env.GITHUB_CLIENT_ID ??
    ''
  ).trim()
  return id ? id : null
}

/**
 * A GitHub App id where an OAuth App id belongs — worth refusing to stay
 * silent about. GitHub App user tokens expire after 8 hours, refreshing them
 * requires a client_secret a desktop app has nowhere safe to hold, and the
 * octokit device flow this app uses would silently drop the refresh fields —
 * so the only symptom would be a token that mysteriously dies every 8 hours.
 * OAuth App ids start 'Ov'; GitHub App ids start 'Iv'.
 */
function clientIdWarning(): string | null {
  const id = clientId()
  if (id !== null && /^Iv/.test(id)) {
    return 'The configured GitHub client ID looks like a GitHub App (Iv…). Its tokens expire after 8 hours and this app cannot refresh them — use an OAuth App client ID with device flow enabled.'
  }
  return null
}

function scopes(): string[] {
  const configured = (
    import.meta.env.MAIN_VITE_GITHUB_SCOPES ??
    import.meta.env.GITHUB_SCOPES ??
    ''
  ).trim()
  if (!configured) return DEFAULT_SCOPES
  return configured.split(/[\s,]+/).filter(Boolean)
}

/** Phases 6 and 9 read the token through here rather than touching secrets.ts. */
export function getGitHubToken(): string | null {
  return getSecret('github_token')
}

/**
 * `connected` still means "a token is stored" — that is the honest reading of a
 * synchronous function that cannot make a network call. What it no longer does
 * is stop there: `error` carries what the last GitHub answer actually was.
 *
 * The two are deliberately separate rather than folded into one boolean. A
 * rejected token is not the same as no token: the remedy is Reconnect, not
 * Connect, and the dialog needs to be able to tell them apart to offer it.
 */
export function getGitHubStatus(): GitHubAuthStatus {
  const configured = clientId() !== null
  if (!hasSecret('github_token')) {
    const warning = clientIdWarning()
    return { connected: false, configured, ...(warning ? { error: warning } : {}) }
  }

  // Ciphertext exists but this build's keychain access cannot open it — the
  // routine dev case (every rebuilt Electron is a new ad-hoc signature), also
  // a restored backup or copied profile. Distinct from 'rejected' because the
  // credential is probably fine: the remedy is re-saving it under this build,
  // not suspecting GitHub. getGitHubToken() has to have been *asked* for the
  // failure to be observed, so probe it here.
  if (getGitHubToken() === null && secretUnreadable('github_token')) {
    return {
      connected: true,
      configured,
      tokenState: 'locked',
      login: getAppState('github_account_login') ?? undefined,
      error:
        "This build can't unlock the stored GitHub credential (the app binary changed). Reconnect once to re-save it."
    }
  }

  const storedScopes = getAppState('github_scopes')
  const tokenState = gitHubTokenState()
  return {
    connected: true,
    configured,
    tokenState,
    login: getAppState('github_account_login') ?? undefined,
    scopes: storedScopes ? storedScopes.split(' ') : undefined,
    ...(tokenState === 'rejected'
      ? { error: 'GitHub rejected the stored token. Reconnect to use GitHub features.' }
      : {}),
    // Not an error about the token — an admission that we cannot say. Worded so
    // nobody reconnects a perfectly good token because their wifi dropped.
    ...(tokenState === 'unreachable'
      ? { error: 'Could not reach GitHub to check this token.' }
      : {})
  }
}

/**
 * Asks GitHub whether the stored token still works, and records the answer.
 *
 * Called at launch and when the window regains focus, because the interesting
 * failure — a token revoked on github.com — happens while the app is not
 * looking. Cheap: one `/user` request, no pagination, and it doubles as a
 * refresh of the account label, which was previously written once during the
 * device flow and then left to go stale forever.
 *
 * Never throws. A failure to verify is a status, not an error to surface: the
 * caller is a background check nobody asked for.
 */
export async function verifyGitHubToken(): Promise<GitHubAuthStatus> {
  const token = getGitHubToken()
  if (!token) {
    clearTokenState()
    return getGitHubStatus()
  }

  try {
    const { login } = await gitHubClient(token).whoAmI()
    setAppState('github_account_login', login)
  } catch (error) {
    // `call()` has already recorded a 401 as rejected. Anything else — DNS,
    // a proxy, a captive portal, GitHub itself being down — must not, so the
    // distinction is made on the message it produced rather than assumed.
    if (!/rejected the stored token/i.test(String(error))) markTokenUnreachable()
  }

  return getGitHubStatus()
}

// --- Device flow ------------------------------------------------------------

let state: DeviceFlowState = { status: 'idle' }
/** Bumped on cancel so a superseded in-flight flow can't write to `state`. */
let generation = 0

export function getDeviceFlowState(): DeviceFlowState {
  return state
}

export function startDeviceFlow(): DeviceFlowState {
  if (state.status === 'starting' || state.status === 'awaiting_authorization') return state

  const id = clientId()
  if (!id) {
    state = {
      status: 'error',
      error:
        'GitHub client ID is not configured. Set MAIN_VITE_GITHUB_CLIENT_ID — see .env.example.'
    }
    return state
  }
  if (!isSecretStorageAvailable()) {
    state = {
      status: 'error',
      error: 'OS secret storage is unavailable, so the GitHub token cannot be stored securely.'
    }
    return state
  }

  const requested = scopes()
  const thisGeneration = ++generation
  state = { status: 'starting' }

  const auth = createOAuthDeviceAuth({
    clientType: 'oauth-app',
    clientId: id,
    scopes: requested,
    onVerification(verification) {
      if (thisGeneration !== generation) return
      state = {
        status: 'awaiting_authorization',
        userCode: verification.user_code,
        verificationUri: verification.verification_uri,
        expiresAt: Date.now() + verification.expires_in * 1000
      }
    }
  })

  // Resolves only once the user authorizes; octokit does the polling and
  // honours GitHub's slow_down backoff internally.
  void auth({ type: 'oauth' })
    .then(async ({ token }) => {
      if (thisGeneration !== generation) return
      setSecret('github_token', token)
      setAppState('github_scopes', requested.join(' '))
      // A new token knows nothing about the old one's fate. Without this, a
      // reconnect after a revocation would still read as rejected until the
      // next successful request.
      clearTokenState()

      // Labels the connected account, and — now that it goes through the port
      // rather than its own `new Octokit` — is also the first verification of
      // the token we just stored. Still non-fatal: a missing label is not a
      // reason to refuse a token GitHub just issued.
      try {
        const { login } = await gitHubClient(token).whoAmI()
        setAppState('github_account_login', login)
      } catch {
        deleteAppState('github_account_login')
      }

      if (thisGeneration !== generation) return
      state = { status: 'success' }
    })
    .catch((error: unknown) => {
      if (thisGeneration !== generation) return
      state = { status: 'error', error: describeDeviceFlowError(error) }
    })

  return state
}

/**
 * `unsupported_grant_type` is overwhelmingly the "Enable Device Flow" checkbox
 * being unticked on the OAuth App, which is invisible from the client ID alone
 * and otherwise produces a baffling error.
 */
function describeDeviceFlowError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (/unsupported_grant_type/i.test(message)) {
    return 'GitHub rejected the device flow. Enable "Device Flow" in the OAuth App settings on github.com.'
  }
  if (/expired_token|expired/i.test(message)) {
    return 'The device code expired before it was authorized. Try again.'
  }
  if (/access_denied/i.test(message)) {
    return 'Authorization was denied in the browser.'
  }
  return message
}

export function cancelDeviceFlow(): DeviceFlowState {
  generation++
  state = { status: 'idle' }
  return state
}

export function disconnectGitHub(): GitHubAuthStatus {
  generation++
  state = { status: 'idle' }
  deleteSecret('github_token')
  deleteAppState('github_account_login')
  deleteAppState('github_scopes')
  clearTokenState()
  return getGitHubStatus()
}
