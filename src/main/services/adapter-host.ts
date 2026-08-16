import { adapterFor, type AdapterConfig, type AgentAdapter } from '../adapters'
import { resolveCodexBinary } from './codex-auth'
import { getSecret } from './secrets'
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
function backendEnv(): NodeJS.ProcessEnv {
  const anthropic = getSecret('anthropic_api_key') ?? import.meta.env.MAIN_VITE_ANTHROPIC_API_KEY
  const openai = getSecret('openai_api_key') ?? import.meta.env.MAIN_VITE_OPENAI_API_KEY

  return {
    ...process.env,
    ...(anthropic ? { ANTHROPIC_API_KEY: anthropic } : {}),
    ...(openai ? { OPENAI_API_KEY: openai } : {})
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
export function adapterConfig(): AdapterConfig {
  return { codexBinaryPath: resolveCodexBinary(), env: backendEnv() }
}

export function adapterForBackend(backend: PersonaBackend): AgentAdapter {
  return adapterFor(backend, adapterConfig())
}
