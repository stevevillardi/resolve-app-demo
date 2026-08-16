import { query, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import type { ClaudeAuthStatus } from '../../shared/ipc-contract'
import { getSecret, isSecretStorageAvailable, setSecret } from './secrets'

/**
 * Claude backend auth (blueprint §15A): reuse existing Claude Code CLI auth on
 * the machine if present, otherwise accept an ANTHROPIC_API_KEY.
 *
 * The SDK bundles its own CLI (platform optionalDependencies), so there is
 * nothing for the user to install — the only question is whether that CLI is
 * already logged in.
 */

const DETECTION_TIMEOUT_MS = 20_000

let cached: ClaudeAuthStatus | null = null

/** Set by onboarding; takes precedence over the dev-only .env escape hatch. */
function storedApiKey(): string | null {
  return getSecret('anthropic_api_key') ?? import.meta.env.MAIN_VITE_ANTHROPIC_API_KEY ?? null
}

/**
 * A prompt stream that never produces a message. The CLI subprocess initializes
 * and answers control requests like accountInfo(), but no turn is ever started,
 * so probing auth costs nothing. Torn down by close() in the finally block.
 *
 * Written as a bare async iterator rather than an `async function*` because a
 * generator that never yields is exactly what's wanted here, and that is also
 * exactly what the require-yield lint rule exists to catch.
 */
function idlePrompt(): AsyncIterable<SDKUserMessage> {
  return {
    [Symbol.asyncIterator]: () => ({
      next: () => new Promise<IteratorResult<SDKUserMessage>>(() => {})
    })
  }
}

async function probeAccount(apiKey: string | null): Promise<ClaudeAuthStatus> {
  const session = query({
    prompt: idlePrompt(),
    options: {
      // `env` REPLACES the subprocess environment rather than merging, so
      // process.env has to be spread explicitly or the CLI loses PATH/HOME.
      env: { ...process.env, ...(apiKey ? { ANTHROPIC_API_KEY: apiKey } : {}) },
      // Keep the probe from inheriting this repo's settings/tools.
      settingSources: [],
      // Swallow CLI stderr — an unauthenticated probe is an expected outcome,
      // not something to spray across the app's console.
      stderr: () => {}
    }
  })

  try {
    const info = await withTimeout(session.accountInfo(), DETECTION_TIMEOUT_MS)

    // A third-party provider (Bedrock/Vertex) authenticates externally and
    // reports no email/apiKeySource, but is still perfectly usable.
    const isThirdParty = info.apiProvider != null && info.apiProvider !== 'firstParty'
    const authenticated =
      isThirdParty || Boolean(info.email ?? info.apiKeySource ?? info.tokenSource)

    if (!authenticated) return { authenticated: false, source: null }

    return {
      authenticated: true,
      // apiKeySource 'oauth' means a browser login, i.e. reused CLI auth.
      source: apiKey && info.apiKeySource !== 'oauth' ? 'api_key' : 'cli',
      email: info.email,
      organization: info.organization,
      subscriptionType: info.subscriptionType
    }
  } finally {
    session.close()
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error('Timed out checking Claude authentication')), ms)
    )
  ])
}

export async function getClaudeAuthStatus(forceRefresh = false): Promise<ClaudeAuthStatus> {
  if (cached && !forceRefresh) return cached

  const apiKey = storedApiKey()
  try {
    cached = await probeAccount(apiKey)
  } catch (error) {
    // Detection failing is not the same as being logged out — say so, so the
    // user isn't told to re-enter a key that was never the problem.
    cached = {
      authenticated: Boolean(apiKey),
      source: apiKey ? 'api_key' : null,
      error: error instanceof Error ? error.message : String(error)
    }
  }
  return cached
}

export async function setAnthropicApiKey(apiKey: string): Promise<ClaudeAuthStatus> {
  if (!isSecretStorageAvailable()) {
    return {
      authenticated: false,
      source: null,
      error: 'OS secret storage is unavailable, so the API key cannot be stored securely.'
    }
  }
  setSecret('anthropic_api_key', apiKey.trim())
  return getClaudeAuthStatus(true)
}
