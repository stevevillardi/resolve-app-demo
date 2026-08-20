import type { PersistedMessage } from '../../../shared/domain'

/**
 * The `messages` table is deliberately just id, contact_id, role, content,
 * timestamp. `status` and `error` describe a turn that is currently in flight,
 * not a stored fact, so they live here rather than as columns — a message
 * reloaded from disk is by definition finished.
 */

export type MessageBubbleStatus = 'sent' | 'streaming' | 'error'

/**
 * Kinds are AgentErrorKind (src/shared/agent.ts) exactly, so a failure assigns
 * straight across with no translation table.
 *
 * Every kind has to be here, `unknown` most of all: it is what
 * classifyErrorMessage() returns by default, so a kind dropped from this union
 * takes the common case with it rather than an edge one.
 */
export interface MessageBubbleError {
  kind: 'rate_limit' | 'sandbox_denied' | 'network' | 'auth' | 'session' | 'unknown'
  message: string
}

export interface Message extends PersistedMessage {
  status?: MessageBubbleStatus
  error?: MessageBubbleError
}
