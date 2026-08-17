import type { PersistedMessage } from '../../../shared/domain'

/**
 * Blueprint §12's `messages` table is deliberately just id, contact_id, role,
 * content, timestamp. `status` and `error` describe a turn that is currently
 * in flight, not a stored fact, so they live here rather than as columns —
 * a message reloaded from disk is by definition finished.
 */

export type MessageBubbleStatus = 'sent' | 'streaming' | 'error'

/**
 * Kinds are AgentErrorKind (src/shared/agent.ts) exactly, so a failure assigns
 * straight across with no translation table.
 *
 * `auth` and `unknown` were missing until Phase 6 wired real turns up, and
 * their absence was worse than it looks: `unknown` is what
 * classifyErrorMessage() returns by default, so the one kind that could not be
 * rendered was the common case rather than an edge one.
 */
export interface MessageBubbleError {
  kind: 'rate_limit' | 'sandbox_denied' | 'network' | 'auth' | 'session' | 'unknown'
  message: string
}

export interface Message extends PersistedMessage {
  status?: MessageBubbleStatus
  error?: MessageBubbleError
}
