/**
 * GitHub's remote MCP server, as it actually is — captured, not composed.
 *
 * Measured 2026-08-16 against a real token with `repo` scope:
 *
 *   https://api.githubcopilot.com/mcp/readonly   27 tools
 *   https://api.githubcopilot.com/mcp/           44 tools
 *
 * The server scopes itself by URL path, server-side, so the read-only endpoint
 * does not merely hide the write tools — it does not serve them. That is the
 * first of this app's two layers; the second is githubMcpDenyList() in
 * sandbox.ts, which names them anyway because `sandbox: full_access` sets
 * `permissionMode: 'bypassPermissions'` and the only gate that survives it is a
 * name blacklist.
 *
 * Both lists are transcribed from a `tools/list` response rather than written
 * from the docs, because the deny table is derived from the difference between
 * them and a name this file gets wrong is a hole nothing else would notice.
 * `npm run probe:mcp` (scripts/probe-mcp.ts) re-reads both endpoints and
 * reports any drift — refresh this file from that, never by memory.
 *
 * Deliberately importless. Nothing under src/main/adapters/ may reach electron,
 * the database or a service (see types.ts); constants are the one thing here
 * that cannot possibly violate that.
 */

/** The 27 tools `/mcp/readonly` serves. None of them mutate anything. */
export const GITHUB_MCP_READ_TOOLS = [
  'get_commit',
  'get_file_contents',
  'get_label',
  'get_latest_release',
  'get_me',
  'get_release_by_tag',
  'get_tag',
  'get_team_members',
  'get_teams',
  'issue_read',
  'list_branches',
  'list_commits',
  'list_issue_fields',
  'list_issue_types',
  'list_issues',
  'list_pull_requests',
  'list_releases',
  'list_repository_collaborators',
  'list_tags',
  'pull_request_read',
  'run_secret_scanning',
  'search_code',
  'search_commits',
  'search_issues',
  'search_pull_requests',
  'search_repositories',
  'search_users'
] as const

/**
 * The 17 tools `/mcp/` serves and `/mcp/readonly` does not — i.e. every tool on
 * this server that changes something. 27 + 17 = 44, which is the check that
 * this file is a complete transcription rather than a partial one.
 */
export const GITHUB_MCP_WRITE_TOOLS = [
  'add_comment_to_pending_review',
  'add_issue_comment',
  'add_reply_to_pull_request_comment',
  'create_branch',
  'create_or_update_file',
  'create_pull_request',
  'create_repository',
  'delete_file',
  'fork_repository',
  'issue_write',
  'merge_pull_request',
  'pull_request_review_write',
  'push_files',
  'request_copilot_review',
  'sub_issue_write',
  'update_pull_request',
  'update_pull_request_branch'
] as const

/** Every tool `/mcp/` serves. */
export const GITHUB_MCP_ALL_TOOLS = [...GITHUB_MCP_READ_TOOLS, ...GITHUB_MCP_WRITE_TOOLS] as const

export const GITHUB_MCP_READONLY_URL = 'https://api.githubcopilot.com/mcp/readonly'
export const GITHUB_MCP_URL = 'https://api.githubcopilot.com/mcp/'

/**
 * The id this server carries in the app's own registry, and the prefix both
 * backends put in front of its tool names. Claude renders an MCP tool as
 * `mcp__github__list_issues`; the deny list has to be written in that form for
 * `disallowedTools`, which is what qualifiedGithubToolName() below is for.
 */
export const GITHUB_MCP_SERVER_ID = 'github'

/**
 * The environment variable Codex reads the token from, named in its config as
 * `mcp_servers.github.bearer_token_env_var`. Claude has no equivalent — it
 * takes an Authorization header — so this is used on one backend only. Filled
 * by backendEnv() in services/adapter-host.ts.
 */
export const GITHUB_MCP_TOKEN_ENV = 'PERSONA_ROUTER_GITHUB_MCP_TOKEN'

/** `list_issues` → `mcp__github__list_issues`. */
export function qualifiedGithubToolName(tool: string): string {
  return `mcp__${GITHUB_MCP_SERVER_ID}__${tool}`
}

/**
 * The reverse, for `canUseTool`, which is handed the qualified name. Returns
 * null for anything that is not one of this server's tools — a Bash or Edit
 * call arrives through the same callback and belongs to the other axis.
 */
export function bareGithubToolName(toolName: string): string | null {
  const prefix = `mcp__${GITHUB_MCP_SERVER_ID}__`
  return toolName.startsWith(prefix) ? toolName.slice(prefix.length) : null
}
