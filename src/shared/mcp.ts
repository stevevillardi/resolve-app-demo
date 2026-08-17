/**
 * The MCP servers this app knows how to run, as a closed registry.
 *
 * In `shared/` because both sides need it and neither can reach the other's:
 * the renderer draws the persona editor's checklist from this, and main
 * resolves a granted id into an endpoint and a token. The id constant itself
 * lives in `main/adapters/github-mcp-tools.ts` alongside the tool tables, which
 * the renderer cannot import — nothing under `src/main/adapters/` is reachable
 * from a browser context — so the two are asserted equal by a test rather than
 * shared by an import.
 *
 * **Closed on purpose, and this is the governance decision, not a stub.** An
 * "add a server by URL" field would let a user point a persona at an arbitrary
 * endpoint with no gate behind it: this app narrows GitHub by mapping
 * `githubScope` onto a measured tool inventory, and there is nothing equivalent
 * to do for a server nobody has inventoried. Blueprint §4's two axes describe
 * the disk and GitHub; a persona holding a server that posts to Slack is reach
 * that neither axis covers. Until that third axis exists in its own right, the
 * per-persona allowlist over a curated set *is* the axis — see the comment on
 * `personaTemplateSchema.mcpServerIds` in domain.ts.
 *
 * Adding an entry here is therefore a deliberate act with a design question
 * attached: what narrows it, and what does the UI say it can do?
 */

export interface McpServerInfo {
  id: string
  label: string
  /** One line, shown beside the checkbox in the persona editor. */
  description: string
  /**
   * What decides how far this server reaches. Named so the editor can point at
   * the control that governs it rather than implying the checkbox is the whole
   * decision — ticking `github` grants nothing a `read_only` persona could not
   * already do through the app's own buttons.
   */
  governedBy: string
}

export const MCP_SERVERS: McpServerInfo[] = [
  {
    id: 'github',
    label: 'GitHub',
    description: 'Read issues, pull requests and code on GitHub, and act within its scope.',
    governedBy: 'GitHub scope'
  }
]

export function mcpServerInfo(id: string): McpServerInfo | null {
  return MCP_SERVERS.find((server) => server.id === id) ?? null
}
