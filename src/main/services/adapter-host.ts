import { adapterFor, type AdapterConfig, type AgentAdapter } from '../adapters'
import { GITHUB_MCP_TOKEN_ENV } from '../adapters/github-mcp-tools'
import { resolveCodexBinary } from './codex-auth'
import { getGitHubToken } from './github-auth'
import { getSecret, secretsPathForDenyList } from './secrets'
import type { PersonaBackend } from '../../shared/domain'

/**
 * The one place that turns "which backend" into a configured adapter.
 *
 * Exists because `src/main/adapters/` is deliberately electron-free and
 * database-free (see adapters/types.ts), so everything machine-specific has to
 * be injected from outside. Concentrating that here means a turn started by a
 * message, an @mention (Phase 7) or a routine (Phase 8) is configured
 * identically — the alternative is three call sites that drift.
 */

/**
 * Both backends' API keys, layered over the real environment.
 *
 * Spreading `process.env` is not optional: the Claude SDK's `env` option
 * *replaces* the subprocess environment rather than merging into it, so
 * omitting this costs the child its PATH and HOME. Same recipe as `childEnv()`
 * in codex-auth.ts and the probe in claude-auth.ts.
 *
 * A missing key is left unset rather than set to empty — an empty
 * ANTHROPIC_API_KEY reads to the SDK as "a key was provided and it is invalid",
 * which produces a worse error than no key at all.
 */
function backendEnv(needsGithubToken: boolean): NodeJS.ProcessEnv {
  const anthropic = getSecret('anthropic_api_key') ?? import.meta.env.MAIN_VITE_ANTHROPIC_API_KEY
  const openai = getSecret('openai_api_key') ?? import.meta.env.MAIN_VITE_OPENAI_API_KEY
  // Codex's MCP configuration has no header option — it takes
  // `mcp_servers.<id>.bearer_token_env_var` and reads that variable out of the
  // subprocess environment. Claude sends the same token as an Authorization
  // header instead. Two doors to one destination, and this is the one that
  // needs the environment, so it belongs here: this function is already the
  // only place a secret meets a subprocess.
  //
  // **Only when this session was actually granted the server.** The first
  // version set it whenever an account was connected, on the reasoning that "a
  // session with no server configured has nothing that would read this, and a
  // persona is never given a shell that could echo it". The second half of that
  // was false and was measured to be false: `echo $PERSONA_ROUTER_GITHUB_MCP_TOKEN`
  // is allowed at `workspace_write`, so every persona at that level or above
  // could read the app's GitHub token out of its own environment — including
  // personas granted no MCP server at all.
  //
  // Narrowing it does not make the token safe from a shell that was granted the
  // server; it makes the blast radius the set of personas a human deliberately
  // gave GitHub to, rather than all of them. See docs/plan/15 for the part that
  // cannot be fixed here.
  const github = needsGithubToken ? getGitHubToken() : null

  return {
    ...process.env,
    ...(anthropic ? { ANTHROPIC_API_KEY: anthropic } : {}),
    ...(openai ? { OPENAI_API_KEY: openai } : {}),
    ...(github ? { [GITHUB_MCP_TOKEN_ENV]: github } : {})
  }
}

/**
 * Read fresh per turn rather than cached at startup, so signing in during
 * onboarding takes effect without a relaunch.
 *
 * `codexBinaryPath` is the part that fails late if it is forgotten: the SDK
 * falls back to its own require.resolve lookup, which works in dev and breaks
 * inside a packaged app, where the binary lives in app.asar.unpacked. The
 * resolver needs `electron` to find it, which is exactly why the adapters take
 * it as config instead of importing it.
 */
export function adapterConfig(options: { needsGithubToken?: boolean } = {}): AdapterConfig {
  return {
    codexBinaryPath: resolveCodexBinary(),
    env: backendEnv(options.needsGithubToken ?? false),
    // The field has existed since Phase 5, is plumbed all the way into the
    // Claude OS sandbox, and until now nothing ever filled it — so the one
    // directory its own doc comment names was reachable by every persona. A
    // declared guard with no producer reads as a guard.
    denyReadPaths: [secretsPathForDenyList()]
  }
}

/**
 * `needsGithubToken` defaults to false, so a caller that forgets it gets the
 * closed configuration rather than the open one. The summariser never passes
 * it — it is given no servers at all.
 */
export function adapterForBackend(
  backend: PersonaBackend,
  options: { needsGithubToken?: boolean } = {}
): AgentAdapter {
  return adapterFor(backend, adapterConfig(options))
}
