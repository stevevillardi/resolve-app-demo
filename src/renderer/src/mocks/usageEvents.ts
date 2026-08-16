import type { UsageEvent } from '@/types'
import { CONTACT_IDS } from './contacts'

const BASE_TIME = Date.parse('2026-08-15T09:00:00Z')

export const usageEvents: UsageEvent[] = [
  {
    id: 'usage-1',
    contactId: CONTACT_IDS.codeReviewerPersonaRouter,
    timestamp: BASE_TIME,
    source: 'message',
    inputTokens: 3200,
    outputTokens: 540,
    cachedInputTokens: 2100,
    costUsd: 0.041
  },
  {
    id: 'usage-2',
    contactId: CONTACT_IDS.codeReviewerPersonaRouter,
    timestamp: BASE_TIME + 45_000,
    source: 'message',
    inputTokens: 1800,
    outputTokens: 320,
    costUsd: 0.019
  },
  {
    id: 'usage-3',
    contactId: CONTACT_IDS.refactorBuddyPersonaRouter,
    timestamp: BASE_TIME + 60_000,
    source: 'routine',
    inputTokens: 9400,
    outputTokens: 1120,
    costUsd: 0.087
  },
  {
    id: 'usage-4',
    contactId: CONTACT_IDS.refactorBuddyPersonaRouter,
    timestamp: BASE_TIME + 3_601_000,
    source: 'message',
    inputTokens: 2600,
    outputTokens: 410,
    costUsd: null
  },
  {
    id: 'usage-5',
    contactId: CONTACT_IDS.docsWriterPersonaRouter,
    timestamp: BASE_TIME + 7_200_000,
    source: 'message',
    inputTokens: 1100,
    outputTokens: 0,
    costUsd: 0.006
  }
]
