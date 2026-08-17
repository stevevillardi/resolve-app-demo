import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The three-state token verdict, tested directly for the first time — until
 * Phase 18 it was covered only through github-auth.test.ts, and the ordering
 * rule below is exactly the kind of thing an indirect test lets drift.
 */

const appStateStore = new Map<string, string>()

vi.mock('./app-state', () => ({
  getAppState: (k: string) => appStateStore.get(k) ?? null,
  setAppState: (k: string, v: string) => void appStateStore.set(k, v),
  deleteAppState: (k: string) => void appStateStore.delete(k)
}))

const {
  clearTokenState,
  gitHubTokenState,
  markTokenGood,
  markTokenRejected,
  markTokenUnreachable
} = await import('./github-token-state')

beforeEach(() => {
  appStateStore.clear()
  clearTokenState()
})

describe('gitHubTokenState', () => {
  it('starts unverified', () => {
    expect(gitHubTokenState()).toBe('unverified')
  })

  it('records an answer from GitHub in both directions', () => {
    markTokenGood()
    expect(gitHubTokenState()).toBe('good')
    markTokenRejected()
    expect(gitHubTokenState()).toBe('rejected')
    markTokenGood()
    expect(gitHubTokenState()).toBe('good')
  })

  it('persists a rejection, so a relaunch cannot resurrect the lie', () => {
    markTokenRejected()
    // The store is the persistence; the module keeps no other copy.
    expect(appStateStore.get('github_token_state')).toBe('rejected')
  })

  it('never lets offline outrank a known rejection', () => {
    // A closed laptop lid is not a bad credential — but a bad credential is
    // still bad when the laptop lid is closed.
    markTokenRejected()
    markTokenUnreachable()
    expect(gitHubTokenState()).toBe('rejected')
  })

  it('reports unreachable over good, because the good verdict is stale', () => {
    markTokenGood()
    markTokenUnreachable()
    expect(gitHubTokenState()).toBe('unreachable')
  })

  it('does not persist unreachable — it describes this moment, not this token', () => {
    markTokenUnreachable()
    expect(appStateStore.has('github_token_state')).toBe(false)
  })

  it('an answer from GitHub clears unreachable', () => {
    markTokenUnreachable()
    markTokenGood()
    expect(gitHubTokenState()).toBe('good')
  })

  it('clearTokenState forgets everything', () => {
    markTokenRejected()
    markTokenUnreachable()
    clearTokenState()
    expect(gitHubTokenState()).toBe('unverified')
    expect(appStateStore.has('github_token_state')).toBe(false)
  })
})
