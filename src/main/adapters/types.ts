import type { AgentCapabilities, AgentEvent, AgentUsage } from '../../shared/agent'
import type { GroupMessage, PersonaBackend, PersonaTemplate, Skill } from '../../shared/domain'

/**
 * The AgentAdapter contract (blueprint §3).
 *
 * Nothing in src/main/adapters/ may import `electron` or the database. The
 * caller resolves a persona's skills and hands them in; the adapter composes
 * context, runs, and yields normalized events. That rule is what lets
 * scripts/probe-adapters.ts drive these outside Electron, and what makes the
 * normalization testable without spending money on API calls.
 */

/**
 * One other Contact's branch, as this session is told about it.
 *
 * Declared here rather than in the service that resolves it for the same reason
 * SessionSpec is: this is the shape the adapters agree on, and nothing under
 * src/main/adapters/ may import a service.
 */
export interface SiblingBranch {
  branch: string
  /** Whose it is, so the model can attribute the work in its own summary. */
  contactName: string
  headSha: string | null
}

/**
 * A repo skill described to the model rather than discovered by it.
 *
 * Structurally the same as `RepoSkill` in services/repo-instructions.ts, and
 * declared separately for the reason SiblingBranch is: this is the shape the
 * adapters agree on, and nothing here may import a service. The fields the
 * adapters actually render are the only ones repeated.
 */
export interface InjectedSkill {
  name: string
  description: string
  /** Absolute, because the model has to be able to read it on request. */
  path: string
}

/** The bound repository's own instructions, and which file they came from. */
export interface RepoInstructionsBlock {
  fileName: string
  content: string
}

/**
 * An MCP server, resolved down to what an adapter needs to configure it.
 *
 * The narrowing has already happened by the time this arrives: `url` is the
 * endpoint the persona's `githubScope` earned, and `deniedTools` /
 * `disallowedTools` are the second layer over it. An adapter's job is to pass
 * these through, never to decide them — see githubMcpDenyList() in sandbox.ts,
 * which is the single table both layers read.
 */
export interface ResolvedServer {
  id: string
  url: string
  /** The bearer token itself. Claude sends it as an Authorization header. */
  token: string
  /**
   * The environment variable the token has been placed in, for backends that
   * take a variable name rather than the value.
   *
   * Codex is the one that does, and the indirection is not a style preference:
   * its config object is flattened into `--config key=value` argv, which any
   * process on the machine can read out of `ps`. Filled by backendEnv() in
   * services/adapter-host.ts, the one place secrets meet a subprocess.
   *
   * Carried here rather than derived in the adapter so that an adapter never
   * has to know which server this is — see the note above about deciding.
   */
  tokenEnvVar: string
  /** Bare names, for the in-process `canUseTool` check. */
  deniedTools: string[]
  /** The same names qualified as `mcp__<id>__*`, for `disallowedTools`. */
  disallowedTools: string[]
}

/**
 * Everything an adapter needs to start or resume a session.
 *
 * Deviates from blueprint §3's literal `createSession(persona, repoPath)`:
 * skill *content* has to arrive from outside, because resolving skillIds means
 * touching the database and adapters don't.
 */
export interface SessionSpec {
  persona: PersonaTemplate
  /**
   * Absolute path to the directory the session works in. Becomes the cwd.
   *
   * Named for the repo because that is what it was until Phase 12; since then it
   * is the *working* path, which for an isolated Contact is its worktree rather
   * than the repo itself. Everything downstream — the cwd, the write boundary,
   * isInsideRepo()'s fence — wants the working path, so the name is the only
   * thing that stayed behind.
   */
  repoPath: string
  /**
   * Directories outside `repoPath` that a writing session must still be able to
   * write to. Empty unless the session runs in a `git worktree`.
   *
   * A worktree's `.git` is a file pointing back into the main repo, so a commit
   * writes outside the working directory and a sandbox fenced to the cwd fails
   * at `git add`. Resolved by the caller with gitWritePathsFor(), for the same
   * reason `skills` is: it means running git, and nothing here may.
   */
  writablePaths?: string[]
  /**
   * Branches other Contacts on this repo are working on, which are checked out
   * nowhere this session can see.
   *
   * Resolved by the caller, like `skills` and `groupContext`. Injected rather
   * than left to be discovered because a persona cannot find this out: `git
   * branch` and `git worktree` are denied at read_only on purpose.
   */
  siblingBranches?: SiblingBranch[]
  /**
   * Set only when the session runs somewhere other than its repository, so the
   * prompt can say where that is. See the comment in composeInstructions: a
   * worktree session can write to the repo's git admin directory, and a model
   * given a bare relative filename will sometimes resolve it against that.
   */
  workingContext?: { workingPath: string; repoPath: string; branch: string }
  /** Already resolved from persona.skillIds by the caller (blueprint §5). */
  skills: Skill[]
  /**
   * The names of the *repository's own* skills this Contact has been given.
   *
   * A different thing from `skills` above, and the two are easy to confuse: a
   * `Skill` here is the app's own injected prose (blueprint §4), while these
   * are `SKILL.md` documents the repo ships and the backend discovers by
   * itself. Anything a backend would find and that is not named here is
   * disabled by name before the turn starts — see codexConfigFor().
   *
   * Empty or unset means "none", which is what every Contact gets until a
   * human opts in. It is an allowlist rather than a boolean so that a skill
   * committed to the repo after the approval does not inherit it.
   */
  repoSkills?: string[]
  /**
   * Repo skills the backend cannot discover for itself, described to the model
   * instead: name, description, and the absolute path of the `SKILL.md` to read
   * when it becomes relevant.
   *
   * Every approved skill on Claude arrives this way, because opening its
   * discovery means `settingSources: ['project']`, which is one switch for six
   * things — one of them `.claude/settings.json` and its `permissions.allow`
   * Bash grants. On Codex only the `.claude/skills` entries land here; the rest
   * are named in `repoSkills` above and discovered natively.
   *
   * Resolved by the caller (capabilitiesFor) for the usual reason: choosing
   * which of the two lists a skill belongs in needs the Contact's trust record,
   * which is in the database.
   */
  injectedSkills?: InjectedSkill[]
  /**
   * The bound repository's own `CLAUDE.md` or `AGENTS.md`, when this Contact
   * has been opted in to trusting it.
   *
   * Unset is the default and the safe direction. Both backends can find these
   * files by themselves and this app stops them (`settingSources: []`,
   * `project_doc_max_bytes: 0`); the text arrives here or it does not arrive.
   */
  repoInstructions?: RepoInstructionsBlock
  /**
   * MCP servers this session may reach, already narrowed to what the persona's
   * `githubScope` permits — the endpoint chosen and the denied tool names
   * resolved before the adapter sees them.
   *
   * Resolved by the caller because it needs the OS keychain for the token and
   * the database for the persona's server allowlist, and nothing here may reach
   * either.
   */
  mcpServers?: ResolvedServer[]
  /**
   * The repo's recent Group summaries, oldest first — blueprint §5's second
   * injection source and the mechanism behind §16 Journey 2.
   *
   * Resolved by the caller for the same reason `skills` is: selecting them
   * means querying the database, and nothing under src/main/adapters/ may.
   * See contextForRepo() in src/main/services/group-messages.ts.
   */
  groupContext?: GroupMessage[]
  /**
   * Everything this session has already been billed for, so a backend that
   * reports usage cumulatively can be reduced to one turn's own figure.
   *
   * Resolved by the caller for the same reason `skills` and `groupContext` are:
   * it comes from `usage_events`, and nothing here may query. See baselineFor()
   * in src/main/services/usage-events.ts, which also records the measurements
   * that made this necessary.
   *
   * Only the Codex adapter reads it — Claude's figures were verified per-turn
   * under `resume`. Leaving it unset means "no baseline known", which is
   * correct for a fresh session and merely over-reports once for a resumed one.
   */
  usageBaseline?: AgentUsage | null
  /** Overrides the backend's default. Mostly for the probe CLI. */
  model?: string
}

/**
 * A session is just its spec plus a resume key — no live handle.
 *
 * That falls out of how both SDKs actually work: Codex spawns a fresh
 * `codex exec` subprocess per turn and resumes by thread id, and Claude's
 * query() is likewise per-turn with `resume`. Neither keeps a process alive
 * between turns, so there is nothing for a session object to hold onto.
 */
export interface AgentSession {
  readonly backend: PersonaBackend
  readonly spec: SessionSpec
  /**
   * Persist this on Contact.backendSessionId. Null until the first turn
   * reports one; the adapter fills it in mid-stream, so read it after the
   * `session_started` event rather than before the run.
   */
  sessionId: string | null
}

/**
 * Host-supplied wiring. Kept separate from SessionSpec because it describes
 * the machine, not the persona.
 */
export interface AdapterConfig {
  /**
   * Absolute path to the vendored `codex` binary. Injected rather than
   * imported: the resolver (src/main/services/codex-auth.ts) needs `electron`
   * to find it inside a packaged asar, and this layer stays electron-free.
   * When null, the SDK falls back to its own require.resolve lookup — fine in
   * dev, broken inside a packaged app.
   */
  codexBinaryPath?: string | null
  /** Extra environment for the backend subprocess. Merged, never replacing. */
  env?: NodeJS.ProcessEnv
  /**
   * Absolute paths the agent must never read, passed to the OS sandbox's
   * `filesystem.denyRead`. Injected for the same reason as codexBinaryPath:
   * the obvious entry is the app's own `userData/secrets` directory (see
   * src/main/services/secrets.ts) and resolving that needs `electron`.
   *
   * Deliberately NOT defaulted to the backends' own credential files — the
   * CLIs authenticate with those, and denying them would break the session
   * rather than harden it.
   */
  denyReadPaths?: string[]
  /**
   * Every native SDK message, before normalization. Exists for
   * scripts/probe-adapters.ts --raw, which is how the token-accounting and
   * context-injection questions in blueprint §14 get answered — they need the
   * numbers the SDK actually returned, not our reading of them.
   */
  onRawEvent?: (event: unknown) => void
}

/**
 * One schema-constrained answer, normalized across two rather different SDKs.
 *
 * `data` is `unknown` because neither SDK types it any better — Claude's
 * `structured_output` and Codex's JSON-bearing `finalResponse` are both opaque.
 * The caller validates with Zod, which is the only place the shape is actually
 * known.
 *
 * `data` is null rather than a throw when the backend could not produce a
 * conforming object: Claude retries internally and gives up with
 * `error_max_structured_output_retries`, and Codex can return prose where JSON
 * was asked for. Both mean "no answer this time", which is a degradation the
 * caller should absorb, not an error it should propagate.
 */
export interface StructuredResult {
  data: unknown | null
  usage: AgentUsage | null
}

export interface AgentAdapter {
  readonly backend: PersonaBackend
  readonly capabilities: AgentCapabilities
  createSession(spec: SessionSpec): AgentSession
  resume(spec: SessionSpec, sessionId: string): AgentSession
  run(session: AgentSession, prompt: string, signal?: AbortSignal): AsyncIterable<AgentEvent>
  /**
   * One turn that answers with JSON matching `schema`, for blueprint §6's
   * end-of-session compaction.
   *
   * Beside run() rather than an option on it, for three reasons that only
   * showed up on reading the vendored SDKs:
   *
   * 1. Claude's `outputFormat` is a **session-level** option, so it cannot be
   *    switched on for the last turn of a live conversational session. Codex's
   *    `outputSchema` is per-turn. There is no granularity both share.
   * 2. The two backends put the answer in different places — Claude on a
   *    separate `structured_output` field, Codex as a JSON string in the same
   *    `finalResponse` that would otherwise hold prose. Normalising that is
   *    exactly the job this layer exists for.
   * 3. Nothing about it should reach the renderer. It returns a promise rather
   *    than an event stream so there is no stream to accidentally forward.
   *
   * The schema handed in must satisfy **both** backends' validators, which are
   * not equally permissive — see SUMMARY_JSON_SCHEMA in `src/shared/summary.ts`
   * for the strict-mode constraint Codex imposes.
   *
   * Callers should pass a session built for this purpose, not a persona's own —
   * see src/main/services/compaction.ts.
   */
  summarize(
    session: AgentSession,
    prompt: string,
    schema: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<StructuredResult>
}
