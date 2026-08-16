export interface Group {
  id: string
  repoPath: string
}

export type GroupMessageType = 'system_summary' | 'user_mention' | 'agent_reply' | 'routine_run'

export type SystemSummaryCategory = 'decision' | 'tradeoff' | 'routine'

export interface GroupMessage {
  id: string
  groupId: string
  timestamp: number
  type: GroupMessageType
  contactId?: string
  content: string
  category?: SystemSummaryCategory
  durable?: boolean
}
