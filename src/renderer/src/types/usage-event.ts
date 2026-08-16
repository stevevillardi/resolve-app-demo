export type UsageSource = 'message' | 'routine'

export interface UsageEvent {
  id: string
  contactId: string
  timestamp: number
  source: UsageSource
  inputTokens: number
  outputTokens: number
  cachedInputTokens?: number
  costUsd: number | null
}

export interface UsageSummary {
  totalCostUsd: number | null
  totalInputTokens: number
  totalOutputTokens: number
  totalCachedInputTokens?: number
}
