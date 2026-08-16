import { describe, expect, it, vi } from 'vitest'

/**
 * The one place `AdapterConfig` is built for the whole app, so a turn started
 * by a message, an @mention or a routine is configured identically.
 *
 * It had no tests until Phase 14, and the gap was not academic: `denyReadPaths`
 * had been declared on AdapterConfig since Phase 5, plumbed all the way into
 * the Claude OS sandbox, asserted in sandbox.test.ts — and never supplied by
 * anyone. Both halves of that plumbing were covered and the join between them
 * was not, which is exactly the shape of hole an integration point leaves.
 */

const USER_DATA = '/tmp/persona-router-test-userdata'

vi.mock('electron', () => ({
  app: { getPath: () => USER_DATA },
  safeStorage: { isEncryptionAvailable: () => true }
}))
vi.mock('./codex-auth', () => ({ resolveCodexBinary: () => '/usr/local/bin/codex' }))

const { adapterConfig } = await import('./adapter-host')

describe('adapterConfig', () => {
  it("keeps agents out of the app's own secret store", () => {
    // Written from the claim rather than from the code: the property is "a
    // persona cannot read where this app keeps its credentials", and it is the
    // producer that was missing, not the guard.
    expect(adapterConfig().denyReadPaths).toEqual([`${USER_DATA}/secrets`])
  })

  it('still injects the binary path and the backend environment', () => {
    // Guards the whole return value, not just the new field. Forgetting
    // codexBinaryPath works in dev and breaks only inside a packaged app,
    // which is the worst place to find out.
    const config = adapterConfig()
    expect(config.codexBinaryPath).toBe('/usr/local/bin/codex')
    expect(config.env?.PATH).toBe(process.env.PATH)
  })
})
