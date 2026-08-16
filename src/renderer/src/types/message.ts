import type { PersistedMessage } from '../../../shared/domain'

/**
 * Blueprint §12's `messages` table is deliberately just id, contact_id, role,
 * content, timestamp. `status` and `error` describe a turn that is currently
 * in flight, not a stored fact, so they live here rather than as columns —
 * a message reloaded from disk is by definition finished.
 */

export type MessageBubbleStatus = 'sent' | 'streaming' | 'error'

export interface MessageBubbleError {
  kind: 'rate_limit' | 'sandbox_denied' | 'network'
  message: string
}

export interface Message extends PersistedMessage {
  status?: MessageBubbleStatus
  error?: MessageBubbleError
}
