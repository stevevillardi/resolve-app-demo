import { adapterFor, type AdapterConfig, type AgentAdapter } from '../adapters'
import { GITHUB_MCP_TOKEN_ENV } from '../adapters/github-mcp-tools'
import { resolveClaudeBinary } from './claude-auth'
import { resolveCodexBinary } from './codex-auth'
import { getGitHubToken } from './github-auth'
import { getSecret, secretsPathForDenyList } from './secrets'
import type { ApprovalOutcome, ApprovalRequest } from '../adapters/types'
import type { PersonaBackend } from '../../shared/domain'

/**
 * The one place that turns "which backend" into a configured adapter.
 *
 * Exists because `src/main/adapters/` is deliberately electron-free and
 * database-free (see adapters/types.ts), so everything machine-specific has to
 * be injected from outside. Concentrating that here means a turn started by a
 * message, an @mention or a routine is configured identically — the
 * alternative is three call sites that drift.
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
function backendEnv(backend: PersonaBackend, needsGithubToken: boolean): NodeJS.ProcessEnv {
  const anthropic = getSecret('anthropic_api_key') ?? import.meta.env.MAIN_VITE_ANTHROPIC_API_KEY
  const openai = getSecret('openai_api_key') ?? import.meta.env.MAIN_VITE_OPENAI_API_KEY
  // Codex's MCP configuration has no header option — it takes
  // `mcp_servers.<id>.bearer_token_env_var` and reads that variable out of the
  // subprocess environment. Claude sends the same token as an Authorization
  // header instead. Two doors to one destination, and this is the one that
  // needs the environment, so it belongs here: this function is already the
  // only place a secret meets a subprocess.
  //
  // **Only when this session was actually granted the server.** Setting it
  // whenever an account is connected would rest on "a session with no server
  // configured has nothing that would read this, and a persona is never given a
  // shell that could echo it". The second half of that is false, and measured
  // to be false: `echo $SWITCHBOARD_GITHUB_MCP_TOKEN` is allowed at
  // `workspace_write`, so every persona at that level or above could read the
  // app's GitHub token out of its own environment — including personas granted
  // no MCP server at all.
  //
  // Narrowing it does not make the token safe from a shell that was granted the
  // server; it makes the blast radius the set of personas a human deliberately
  // gave GitHub to, rather than all of them. The reading itself cannot be shut
  // off from inside this process: the shell guard is a deny list matched
  // against command text, which raises echoing this variable from "type the
  // obvious command" to "deliberately work around a stated restriction", but is
  // not a boundary.
  //
  // And only for Codex: Claude receives the token as an Authorization header on
  // the server config and never reads this variable, so setting it in Claude's
  // subprocess would put the secret somewhere with no reader — harmless until
  // something grows one.
  const github = backend === 'codex' && needsGithubToken ? getGitHubToken() : null

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
 * The two binary paths are the part that fails late if forgotten: each SDK
 * falls back to its own require.resolve lookup, which works in dev and breaks
 * inside a packaged app, where the binaries live in app.asar.unpacked. The
 * resolvers need `electron` to find them, which is exactly why the adapters
 * take them as config instead of importing.
 *
 * "Fails late" is literal: the whole class of bug is invisible until the app is
 * packaged — every test and every dev run resolves these correctly — so a
 * binary path missing from this object survives the entire suite and shows up
 * only in a build.
 */
export interface AdapterHostOptions {
  needsGithubToken?: boolean
  /**
   * The turn's route into the pending-approval registry. Carried
   * per adapter construction rather than resolved here because an approval
   * belongs to a *run* — the registry needs the runId and contactId, and only
   * the caller starting the turn has them.
   */
  onApprovalRequest?: (request: ApprovalRequest) => Promise<ApprovalOutcome>
}

export function adapterConfig(
  backend: PersonaBackend,
  options: AdapterHostOptions = {}
): AdapterConfig {
  return {
    codexBinaryPath: resolveCodexBinary(),
    // Both backends, for the same reason: inside a packaged app neither SDK's
    // own require.resolve lookup finds its binary — see AdapterConfig.
    claudeBinaryPath: resolveClaudeBinary(),
    env: backendEnv(backend, options.needsGithubToken ?? false),
    // `denyReadPaths` is plumbed all the way into the Claude OS sandbox, and
    // this line is its only producer: without it the one directory its own doc
    // comment names is reachable by every persona, because a declared guard
    // that nobody fills still reads as a guard.
    denyReadPaths: [secretsPathForDenyList()],
    ...(options.onApprovalRequest ? { onApprovalRequest: options.onApprovalRequest } : {})
  }
}

/**
 * `needsGithubToken` defaults to false, so a caller that forgets it gets the
 * closed configuration rather than the open one. The summariser never passes
 * it — it is given no servers at all.
 */
export function adapterForBackend(
  backend: PersonaBackend,
  options: AdapterHostOptions = {}
): AgentAdapter {
  return adapterFor(backend, adapterConfig(backend, options))
}
