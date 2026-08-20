import { describe, expect, it } from 'vitest'
import { MCP_SERVERS, mcpServerInfo } from './mcp'
import { GITHUB_MCP_SERVER_ID } from '../main/adapters/github-mcp-tools'

/**
 * The registry is the renderer's copy of an identity that main owns.
 *
 * `GITHUB_MCP_SERVER_ID` lives beside the tool tables in
 * main/adapters/github-mcp-tools.ts, which the renderer cannot import — nothing
 * under src/main/adapters/ is reachable from a browser context. So the two are
 * kept in step by this test rather than by an import, and the failure it exists
 * to catch is the quiet one: an id renamed on one side leaves a checkbox that
 * grants a server main will never resolve.
 */

describe('the curated registry', () => {
  it('uses the same id main resolves servers by', () => {
    expect(MCP_SERVERS.map((server) => server.id)).toContain(GITHUB_MCP_SERVER_ID)
  })

  it('is a closed set, not an open one', () => {
    // Closed on purpose — a governance decision rather than a stub waiting to
    // be filled in.
    // An arbitrary server by URL is reach with no gate behind it: GitHub is
    // narrowed by mapping githubScope onto a measured tool inventory, and there
    // is nothing equivalent to do for an endpoint nobody has inventoried.
    expect(MCP_SERVERS).toHaveLength(1)
  })

  it('says what governs each server, not just what it is', () => {
    for (const server of MCP_SERVERS) {
      expect(server.governedBy.length).toBeGreaterThan(0)
      expect(server.description.length).toBeGreaterThan(0)
    }
  })

  it('has no id twice', () => {
    expect(new Set(MCP_SERVERS.map((s) => s.id)).size).toBe(MCP_SERVERS.length)
  })

  it('returns null for a server the app does not know how to run', () => {
    expect(mcpServerInfo('slack')).toBeNull()
  })
})
