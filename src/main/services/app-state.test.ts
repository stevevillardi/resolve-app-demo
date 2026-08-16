import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestDb } from '../db/test-db'
import type { AppDatabase } from '../db/create'

/**
 * Runs against a real in-memory SQLite rather than a mocked Drizzle, so the
 * generated SQL and the onConflictDoUpdate upsert are actually exercised —
 * mocking the query builder would only assert that the code calls itself.
 *
 * The schema comes from the checked-in migrations via createTestDb rather than
 * a hand-written CREATE TABLE: a copy here would drift from the real migration
 * the moment either changed, and the drift would look like a passing test.
 */

let db: AppDatabase

vi.mock('../db', () => ({ initDb: () => db }))

const { getAppState, setAppState, deleteAppState, getAppStateFlag, setAppStateFlag } =
  await import('./app-state')

beforeEach(() => {
  db = createTestDb()
})

describe('read and write', () => {
  it('returns null for a key that was never set', () => {
    expect(getAppState('github_account_login')).toBeNull()
  })

  it('round-trips a value', () => {
    setAppState('github_account_login', 'stevevillardi')
    expect(getAppState('github_account_login')).toBe('stevevillardi')
  })

  it('upserts rather than failing on the primary key', () => {
    // Reconnecting a different GitHub account must overwrite, not throw.
    setAppState('github_account_login', 'first')
    expect(() => setAppState('github_account_login', 'second')).not.toThrow()
    expect(getAppState('github_account_login')).toBe('second')
  })

  it('keeps keys independent', () => {
    setAppState('github_account_login', 'octocat')
    setAppState('github_scopes', 'repo read:user')
    expect(getAppState('github_account_login')).toBe('octocat')
    expect(getAppState('github_scopes')).toBe('repo read:user')
  })

  it('preserves a value containing spaces', () => {
    // github_scopes is stored space-joined and split on read.
    setAppState('github_scopes', 'repo read:user workflow')
    expect(getAppState('github_scopes')?.split(' ')).toEqual(['repo', 'read:user', 'workflow'])
  })
})

describe('deletion', () => {
  it('removes only the named key', () => {
    setAppState('github_account_login', 'octocat')
    setAppState('github_scopes', 'repo')
    deleteAppState('github_account_login')
    expect(getAppState('github_account_login')).toBeNull()
    expect(getAppState('github_scopes')).toBe('repo')
  })

  it('is a no-op for a missing key', () => {
    expect(() => deleteAppState('onboarding_completed')).not.toThrow()
  })
})

describe('flags', () => {
  it('defaults to false when unset', () => {
    expect(getAppStateFlag('onboarding_completed')).toBe(false)
  })

  it('round-trips true and false', () => {
    setAppStateFlag('onboarding_completed', true)
    expect(getAppStateFlag('onboarding_completed')).toBe(true)
    setAppStateFlag('onboarding_completed', false)
    expect(getAppStateFlag('onboarding_completed')).toBe(false)
  })

  it('treats any non-"true" stored value as false', () => {
    setAppState('onboarding_completed', 'yes')
    expect(getAppStateFlag('onboarding_completed')).toBe(false)
  })
})
