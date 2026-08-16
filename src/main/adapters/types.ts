import type { AgentCapabilities, AgentEvent } from '../../shared/agent'
import type { PersonaBackend, PersonaTemplate, Skill } from '../../shared/domain'

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
 * Everything an adapter needs to start or resume a session.
 *
 * Deviates from blueprint §3's literal `createSession(persona, repoPath)`:
 * skill *content* has to arrive from outside, because resolving skillIds means
 * touching the database and adapters don't.
 */
export interface SessionSpec {
  persona: PersonaTemplate
  /** Absolute path to the repo the session works in. Becomes the cwd. */
  repoPath: string
  /** Already resolved from persona.skillIds by the caller (blueprint §5). */
  skills: Skill[]
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

export interface AgentAdapter {
  readonly backend: PersonaBackend
  readonly capabilities: AgentCapabilities
  createSession(spec: SessionSpec): AgentSession
  resume(spec: SessionSpec, sessionId: string): AgentSession
  run(session: AgentSession, prompt: string, signal?: AbortSignal): AsyncIterable<AgentEvent>
}
