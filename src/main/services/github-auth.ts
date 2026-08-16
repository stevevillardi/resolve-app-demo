import { createOAuthDeviceAuth } from '@octokit/auth-oauth-device'
import { Octokit } from '@octokit/rest'
import type { DeviceFlowState, GitHubAuthStatus } from '../../shared/ipc-contract'
import { deleteAppState, getAppState, setAppState } from './app-state'
import { deleteSecret, getSecret, hasSecret, isSecretStorageAvailable, setSecret } from './secrets'

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

export function getGitHubStatus(): GitHubAuthStatus {
  const configured = clientId() !== null
  if (!hasSecret('github_token')) {
    return { connected: false, configured }
  }

  const storedScopes = getAppState('github_scopes')
  return {
    connected: true,
    configured,
    login: getAppState('github_account_login') ?? undefined,
    scopes: storedScopes ? storedScopes.split(' ') : undefined
  }
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

      // Purely to label the connected account in the UI.
      try {
        const { data } = await new Octokit({ auth: token }).rest.users.getAuthenticated()
        setAppState('github_account_login', data.login)
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
  return getGitHubStatus()
}
