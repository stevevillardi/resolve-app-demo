import type { AuthStatus } from '../../shared/ipc-contract'
import { getAppStateFlag, setAppStateFlag } from './app-state'
import { getClaudeAuthStatus } from './claude-auth'
import { getCodexAuthStatus } from './codex-auth'
import { getGitHubStatus } from './github-auth'
import { isSecretStorageAvailable } from './secrets'

/**
 * The one place the three independent backend states are combined. They are
 * kept as separate objects on purpose: "GitHub connected but Codex not" has to
 * render sensibly, which a single flattened enum would make awkward.
 */
export async function getAuthStatus(forceRefresh = false): Promise<AuthStatus> {
  const claude = await getClaudeAuthStatus(forceRefresh)
  return {
    claude,
    codex: getCodexAuthStatus(forceRefresh),
    github: getGitHubStatus(),
    onboardingCompleted: getAppStateFlag('onboarding_completed'),
    secretStorageAvailable: isSecretStorageAvailable()
  }
}

export async function completeOnboarding(): Promise<AuthStatus> {
  setAppStateFlag('onboarding_completed', true)
  return getAuthStatus()
}
