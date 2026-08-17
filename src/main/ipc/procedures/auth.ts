import { registerProcedure } from '../registerProcedure'
import { completeOnboarding, getAuthStatus } from '../../services/auth-status'
import { setAnthropicApiKey } from '../../services/claude-auth'
import { setOpenAiApiKey } from '../../services/codex-auth'

registerProcedure('auth.getStatus', () => getAuthStatus())

registerProcedure('auth.refresh', () => getAuthStatus(true))

registerProcedure('auth.setAnthropicApiKey', ({ apiKey }) => setAnthropicApiKey(apiKey))

registerProcedure('auth.setOpenAiApiKey', ({ apiKey }) => setOpenAiApiKey(apiKey))

registerProcedure('auth.completeOnboarding', () => completeOnboarding())
