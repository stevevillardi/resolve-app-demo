import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The device-flow state machine. Octokit and the secret store are faked so the
 * transitions, the generation guard, and the error translation are what's
 * under test — not GitHub's API, which was verified live during Phase 3.
 */

const secretStore = new Map<string, string>()
const appStateStore = new Map<string, string>()
let encryptionAvailable = true
let clientId: string | undefined = 'Ov23liTESTCLIENTID'

/** Resolves when the flow's internal promise chain has drained. */
const settle = (): Promise<void> => new Promise((r) => setImmediate(r))

// --- Octokit doubles ---------------------------------------------------------
type Verification = { user_code: string; verification_uri: string; expires_in: number }
let onVerificationCb: ((v: Verification) => void) | undefined
let authResult: { resolve: (t: string) => void; reject: (e: Error) => void }
let getAuthenticatedImpl = async (): Promise<{ data: { login: string } }> => ({
  data: { login: 'stevevillardi' }
})

vi.mock('@octokit/auth-oauth-device', () => ({
  createOAuthDeviceAuth: (opts: { onVerification: (v: Verification) => void }) => {
    onVerificationCb = opts.onVerification
    return () =>
      new Promise<{ token: string }>((resolve, reject) => {
        authResult = { resolve: (token) => resolve({ token }), reject }
      })
  }
}))

vi.mock('@octokit/rest', () => ({
  Octokit: class {
    rest = { users: { getAuthenticated: () => getAuthenticatedImpl() } }
  }
}))

vi.mock('./secrets', () => ({
  getSecret: (k: string) => secretStore.get(k) ?? null,
  setSecret: (k: string, v: string) => void secretStore.set(k, v),
  deleteSecret: (k: string) => void secretStore.delete(k),
  hasSecret: (k: string) => secretStore.has(k),
  isSecretStorageAvailable: () => encryptionAvailable
}))

vi.mock('./app-state', () => ({
  getAppState: (k: string) => appStateStore.get(k) ?? null,
  setAppState: (k: string, v: string) => void appStateStore.set(k, v),
  deleteAppState: (k: string) => void appStateStore.delete(k)
}))

// vi.stubEnv reaches import.meta.env as well as process.env, which is how the
// MAIN_VITE_* config below is swapped per test.
const github = await import('./github-auth')

beforeEach(() => {
  secretStore.clear()
  appStateStore.clear()
  encryptionAvailable = true
  clientId = 'Ov23liTESTCLIENTID'
  onVerificationCb = undefined
  getAuthenticatedImpl = async () => ({ data: { login: 'stevevillardi' } })
  vi.stubEnv('MAIN_VITE_GITHUB_CLIENT_ID', clientId)
  vi.stubEnv('MAIN_VITE_GITHUB_SCOPES', '')
  github.cancelDeviceFlow()
  github.disconnectGitHub()
})

afterEach(() => {
  vi.unstubAllEnvs()
})

/** Drives a flow to the point where GitHub has handed back a code. */
function startAndVerify(code = 'ABCD-1234'): void {
  github.startDeviceFlow()
  onVerificationCb?.({
    user_code: code,
    verification_uri: 'https://github.com/login/device',
    expires_in: 899
  })
}

describe('status', () => {
  it('reports disconnected with no token stored', () => {
    expect(github.getGitHubStatus()).toMatchObject({ connected: false, configured: true })
  })

  it('reports connected once a token exists, with the stored account label', () => {
    secretStore.set('github_token', 'gho_x')
    appStateStore.set('github_account_login', 'stevevillardi')
    appStateStore.set('github_scopes', 'repo read:user')

    expect(github.getGitHubStatus()).toEqual({
      connected: true,
      configured: true,
      login: 'stevevillardi',
      scopes: ['repo', 'read:user']
    })
  })

  it('never leaks the token itself into the status object', () => {
    secretStore.set('github_token', 'gho_supersecret')
    expect(JSON.stringify(github.getGitHubStatus())).not.toContain('gho_supersecret')
  })
})

describe('starting the flow', () => {
  it('reports starting, then awaiting_authorization once the code arrives', () => {
    github.startDeviceFlow()
    expect(github.getDeviceFlowState().status).toBe('starting')

    onVerificationCb?.({
      user_code: 'WXYZ-9999',
      verification_uri: 'https://github.com/login/device',
      expires_in: 899
    })

    expect(github.getDeviceFlowState()).toMatchObject({
      status: 'awaiting_authorization',
      userCode: 'WXYZ-9999',
      verificationUri: 'https://github.com/login/device'
    })
  })

  it('derives an absolute expiry from the relative expires_in', () => {
    const before = Date.now()
    startAndVerify()
    const { expiresAt } = github.getDeviceFlowState()
    expect(expiresAt).toBeGreaterThanOrEqual(before + 899_000)
  })

  it('is idempotent while a flow is already in flight', () => {
    startAndVerify('FIRST-111')
    github.startDeviceFlow()
    // A double-click must not replace the code the user is already typing.
    expect(github.getDeviceFlowState().userCode).toBe('FIRST-111')
  })
})

describe('completion', () => {
  it('stores the token, scopes and account login', async () => {
    startAndVerify()
    authResult.resolve('gho_newtoken')
    await settle()

    expect(secretStore.get('github_token')).toBe('gho_newtoken')
    expect(appStateStore.get('github_scopes')).toBe('repo read:user')
    expect(appStateStore.get('github_account_login')).toBe('stevevillardi')
    expect(github.getDeviceFlowState().status).toBe('success')
  })

  it('still connects when the account-label lookup fails', async () => {
    // The login is cosmetic; losing it must not cost the user their token.
    getAuthenticatedImpl = async () => {
      throw new Error('network down')
    }
    startAndVerify()
    authResult.resolve('gho_newtoken')
    await settle()

    expect(secretStore.get('github_token')).toBe('gho_newtoken')
    expect(github.getGitHubStatus()).toMatchObject({ connected: true, login: undefined })
  })

  it('honours custom scopes from config', async () => {
    vi.stubEnv('MAIN_VITE_GITHUB_SCOPES', 'repo, workflow')
    startAndVerify()
    authResult.resolve('gho_x')
    await settle()
    expect(appStateStore.get('github_scopes')).toBe('repo workflow')
  })
})

describe('cancellation', () => {
  it('returns to idle', () => {
    startAndVerify()
    expect(github.cancelDeviceFlow().status).toBe('idle')
  })

  it('ignores a late success from a cancelled flow', async () => {
    // Otherwise a token the user walked away from lands minutes later.
    startAndVerify()
    github.cancelDeviceFlow()
    authResult.resolve('gho_stale')
    await settle()

    expect(secretStore.has('github_token')).toBe(false)
    expect(github.getDeviceFlowState().status).toBe('idle')
  })

  it('ignores a late verification callback from a cancelled flow', () => {
    github.startDeviceFlow()
    const staleCallback = onVerificationCb
    github.cancelDeviceFlow()

    staleCallback?.({
      user_code: 'STALE-000',
      verification_uri: 'https://github.com/login/device',
      expires_in: 899
    })
    expect(github.getDeviceFlowState().status).toBe('idle')
  })
})

describe('error translation', () => {
  it('explains the unticked Device Flow checkbox', async () => {
    // The single likeliest misconfiguration, and invisible from the client ID.
    startAndVerify()
    authResult.reject(new Error('unsupported_grant_type'))
    await settle()
    expect(github.getDeviceFlowState().error).toMatch(/Enable "Device Flow"/)
  })

  it('explains an expired code', async () => {
    startAndVerify()
    authResult.reject(new Error('expired_token'))
    await settle()
    expect(github.getDeviceFlowState().error).toMatch(/expired/i)
  })

  it('explains a denied authorization', async () => {
    startAndVerify()
    authResult.reject(new Error('access_denied'))
    await settle()
    expect(github.getDeviceFlowState().error).toMatch(/denied/i)
  })

  it('passes through an unrecognised message rather than hiding it', async () => {
    startAndVerify()
    authResult.reject(new Error('something nobody predicted'))
    await settle()
    expect(github.getDeviceFlowState().error).toBe('something nobody predicted')
  })
})

describe('preconditions', () => {
  it('errors without starting when no client ID is configured', () => {
    vi.stubEnv('MAIN_VITE_GITHUB_CLIENT_ID', '')
    const state = github.startDeviceFlow()
    expect(state.status).toBe('error')
    expect(state.error).toMatch(/MAIN_VITE_GITHUB_CLIENT_ID/)
    expect(github.getGitHubStatus().configured).toBe(false)
  })

  it('errors when the OS keychain is unavailable', () => {
    // Acquiring a token we then can't store securely is worse than not asking.
    encryptionAvailable = false
    expect(github.startDeviceFlow()).toMatchObject({ status: 'error' })
  })
})

describe('disconnect', () => {
  it('clears the token and all derived state', () => {
    secretStore.set('github_token', 'gho_x')
    appStateStore.set('github_account_login', 'stevevillardi')
    appStateStore.set('github_scopes', 'repo')

    expect(github.disconnectGitHub().connected).toBe(false)
    expect(secretStore.has('github_token')).toBe(false)
    expect(appStateStore.has('github_account_login')).toBe(false)
    expect(appStateStore.has('github_scopes')).toBe(false)
  })

  it('ignores a late success from a flow that was disconnected mid-run', async () => {
    startAndVerify()
    github.disconnectGitHub()
    authResult.resolve('gho_stale')
    await settle()
    expect(secretStore.has('github_token')).toBe(false)
  })
})

describe('getGitHubToken', () => {
  it('is the read path Phases 6 and 9 use', () => {
    secretStore.set('github_token', 'gho_forlater')
    expect(github.getGitHubToken()).toBe('gho_forlater')
  })
})
