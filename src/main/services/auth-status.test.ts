import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClaudeAuthStatus, CodexAuthStatus, GitHubAuthStatus } from '../../shared/ipc-contract'

/**
 * The aggregate the renderer gates every feature on. The acceptance check this
 * exists for: each backend must report independently, so "GitHub connected but
 * Codex not" (and every other combination) renders sensibly rather than
 * collapsing into one boolean or crashing.
 */

let claude: ClaudeAuthStatus
let codex: CodexAuthStatus
let github: GitHubAuthStatus
let onboardingFlag: boolean
let encryptionAvailable: boolean
const setFlagCalls: Array<[string, boolean]> = []
// cleared per test alongside the rest in beforeEach

vi.mock('./claude-auth', () => ({ getClaudeAuthStatus: async () => claude }))
vi.mock('./codex-auth', () => ({ getCodexAuthStatus: () => codex }))
vi.mock('./github-auth', () => ({ getGitHubStatus: () => github }))
vi.mock('./secrets', () => ({
  isSecretStorageAvailable: () => encryptionAvailable,
  secretUnreadable: (k: string) => unreadableKeys.has(k)
}))
const unreadableKeys = new Set<string>()
vi.mock('./app-state', () => ({
  getAppStateFlag: () => onboardingFlag,
  setAppStateFlag: (k: string, v: boolean) => {
    setFlagCalls.push([k, v])
    onboardingFlag = v
  }
}))

const { getAuthStatus, completeOnboarding } = await import('./auth-status')

beforeEach(() => {
  unreadableKeys.clear()
  claude = { authenticated: false, source: null }
  codex = { authenticated: false, source: null }
  github = { connected: false, configured: true }
  onboardingFlag = false
  encryptionAvailable = true
  setFlagCalls.length = 0
})

describe('independence of the three backends', () => {
  it('reports GitHub connected while the agent backends are not', async () => {
    github = { connected: true, configured: true, login: 'stevevillardi' }

    const status = await getAuthStatus()
    expect(status.github.connected).toBe(true)
    expect(status.claude.authenticated).toBe(false)
    expect(status.codex.authenticated).toBe(false)
  })

  it('reports the agent backends connected while GitHub is not', async () => {
    claude = { authenticated: true, source: 'cli', email: 'steve@villardi.io' }
    codex = { authenticated: true, source: 'cli' }

    const status = await getAuthStatus()
    expect(status.claude.authenticated).toBe(true)
    expect(status.codex.authenticated).toBe(true)
    expect(status.github.connected).toBe(false)
  })

  it('handles every combination without collapsing them', async () => {
    for (const [c, x, g] of [
      [false, false, false],
      [true, false, false],
      [false, true, false],
      [false, false, true],
      [true, true, false],
      [true, false, true],
      [false, true, true],
      [true, true, true]
    ] as Array<[boolean, boolean, boolean]>) {
      claude = { authenticated: c, source: c ? 'cli' : null }
      codex = { authenticated: x, source: x ? 'cli' : null }
      github = { connected: g, configured: true }

      const status = await getAuthStatus()
      expect([
        status.claude.authenticated,
        status.codex.authenticated,
        status.github.connected
      ]).toEqual([c, x, g])
    }
  })

  it('carries a per-backend error without affecting the others', async () => {
    claude = { authenticated: false, source: null, error: 'CLI unavailable' }
    codex = { authenticated: true, source: 'cli' }

    const status = await getAuthStatus()
    expect(status.claude.error).toBe('CLI unavailable')
    expect(status.codex.error).toBeUndefined()
    expect(status.codex.authenticated).toBe(true)
  })
})

describe('launch gating fields', () => {
  it('reports onboarding as incomplete on a fresh profile', async () => {
    expect((await getAuthStatus()).onboardingCompleted).toBe(false)
  })

  it('reports onboarding complete once the flag is set', async () => {
    onboardingFlag = true
    expect((await getAuthStatus()).onboardingCompleted).toBe(true)
  })

  it('surfaces keychain availability so onboarding can warn', async () => {
    encryptionAvailable = false
    expect((await getAuthStatus()).secretStorageAvailable).toBe(false)
  })
})

describe('completeOnboarding', () => {
  it('persists the flag and returns the refreshed status', async () => {
    const status = await completeOnboarding()
    expect(setFlagCalls).toEqual([['onboarding_completed', true]])
    expect(status.onboardingCompleted).toBe(true)
  })

  it('completes even with nothing connected', async () => {
    // Onboarding is skippable by design — every step can be passed over.
    const status = await completeOnboarding()
    expect(status.onboardingCompleted).toBe(true)
    expect(status.claude.authenticated).toBe(false)
    expect(status.github.connected).toBe(false)
  })
})

describe('a stored API key this build cannot decrypt', () => {
  it('says so instead of reporting a clean logged-out', async () => {
    // Without the note the user re-types a key that was never lost.
    claude = { authenticated: false, source: null }
    unreadableKeys.add('anthropic_api_key')

    const status = await getAuthStatus()
    expect(status.claude.error).toMatch(/this build/i)
    // The other backend is untouched.
    expect(status.codex.error).toBeUndefined()
  })

  it('never overwrites a real probe error or an authenticated status', async () => {
    claude = { authenticated: true, source: 'cli' }
    codex = { authenticated: false, source: null, error: 'the check timed out' }
    unreadableKeys.add('anthropic_api_key')
    unreadableKeys.add('openai_api_key')

    const status = await getAuthStatus()
    expect(status.claude.error).toBeUndefined()
    expect(status.codex.error).toBe('the check timed out')
  })
})
