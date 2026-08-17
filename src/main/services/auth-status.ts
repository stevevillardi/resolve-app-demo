import type { AuthStatus } from '../../shared/ipc-contract'
import { getAppStateFlag, setAppStateFlag } from './app-state'
import { getClaudeAuthStatus } from './claude-auth'
import { getCodexAuthStatus } from './codex-auth'
import { getGitHubStatus } from './github-auth'
import { isSecretStorageAvailable, secretUnreadable } from './secrets'

/**
 * The one place the three independent backend states are combined. They are
 * kept as separate objects on purpose: "GitHub connected but Codex not" has to
 * render sensibly, which a single flattened enum would make awkward.
 */
export async function getAuthStatus(forceRefresh = false): Promise<AuthStatus> {
  const claude = await getClaudeAuthStatus(forceRefresh)
  const codex = getCodexAuthStatus(forceRefresh)
  return {
    claude: withUnreadableKeyNote(claude, 'anthropic_api_key'),
    codex: withUnreadableKeyNote(codex, 'openai_api_key'),
    github: getGitHubStatus(),
    onboardingCompleted: getAppStateFlag('onboarding_completed'),
    secretStorageAvailable: isSecretStorageAvailable()
  }
}

/**
 * A stored API key whose ciphertext this build cannot open (see secrets.ts) —
 * without this note, the probe quietly falls back to CLI auth or reports
 * unauthenticated, and the user re-types a key that was never lost. Attached
 * at composition rather than inside each probe so both backends get the same
 * sentence and neither probe has to know about keychain identity.
 */
function withUnreadableKeyNote<T extends { authenticated: boolean; error?: string }>(
  status: T,
  key: 'anthropic_api_key' | 'openai_api_key'
): T {
  if (status.authenticated || status.error || !secretUnreadable(key)) return status
  return {
    ...status,
    error:
      "The stored API key can't be unlocked by this build of the app (the binary changed). Re-enter it once in Settings to re-save it."
  }
}

export async function completeOnboarding(): Promise<AuthStatus> {
  setAppStateFlag('onboarding_completed', true)
  return getAuthStatus()
}
