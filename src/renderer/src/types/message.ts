export type MessageRole = 'user' | 'assistant'

export type MessageBubbleStatus = 'sent' | 'streaming' | 'error'

export interface MessageBubbleError {
  kind: 'rate_limit' | 'sandbox_denied' | 'network'
  message: string
}

export interface Message {
  id: string
  contactId: string
  role: MessageRole
  content: string
  timestamp: number
  status?: MessageBubbleStatus
  error?: MessageBubbleError
}
