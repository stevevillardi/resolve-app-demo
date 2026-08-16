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

const githubToken = { value: 'gho_test' as string | null }
vi.mock('./github-auth', () => ({ getGitHubToken: () => githubToken.value }))

const { adapterConfig } = await import('./adapter-host')
const { GITHUB_MCP_TOKEN_ENV } = await import('../adapters/github-mcp-tools')

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

  it('carries the GitHub token Codex has no other way to receive', () => {
    // Codex's MCP config takes `bearer_token_env_var` and nothing else — no
    // header option exists — so this variable is the only door. Claude sends
    // the same token as an Authorization header and never reads it.
    expect(adapterConfig().env?.[GITHUB_MCP_TOKEN_ENV]).toBe('gho_test')
  })

  it('leaves the variable unset rather than empty when no account is connected', () => {
    // Same reasoning as ANTHROPIC_API_KEY above: an empty value reads as "a
    // token was provided and it is invalid", which is a worse failure than
    // none at all.
    githubToken.value = null
    try {
      expect(GITHUB_MCP_TOKEN_ENV in (adapterConfig().env ?? {})).toBe(false)
    } finally {
      githubToken.value = 'gho_test'
    }
  })
})
