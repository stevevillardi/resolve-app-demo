import type { AgentErrorKind } from '../../shared/agent'

/**
 * Classifies a failure that arrives as prose rather than as a code.
 *
 * Both backends need this. Codex reports every turn failure as a message
 * string, and Claude throws for failures that happen outside the message
 * stream (a missing CLI, a dead socket). The renderer styles rate limits and
 * network blips differently from real errors (blueprint §15C), so the
 * distinction has to survive normalization.
 *
 * Deliberately narrow: anything unrecognised stays `unknown` rather than being
 * guessed into a category the UI would then style misleadingly.
 */
export function classifyErrorMessage(message: string): AgentErrorKind {
  const text = message.toLowerCase()

  if (text.includes('rate limit') || text.includes('429') || text.includes('quota')) {
    return 'rate_limit'
  }
  if (
    text.includes('unauthorized') ||
    text.includes('401') ||
    text.includes('not logged in') ||
    text.includes('sign in again') ||
    text.includes('authentication')
  ) {
    return 'auth'
  }
  if (
    text.includes('sandbox') ||
    text.includes('permission denied') ||
    text.includes('read-only')
  ) {
    return 'sandbox_denied'
  }
  if (
    text.includes('network') ||
    text.includes('econn') ||
    text.includes('enotfound') ||
    text.includes('socket') ||
    text.includes('timed out')
  ) {
    return 'network'
  }
  return 'unknown'
}
