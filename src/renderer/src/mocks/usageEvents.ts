import type { UsageEvent } from '@/types'
import { CONTACT_IDS } from './contacts'

const DAY = 86_400_000
const HOUR = 3_600_000

/** Latest day in the fixture set — everything below is an offset back from it. */
const TODAY = Date.parse('2026-08-15T09:00:00Z')

const day = (daysAgo: number, hours = 0): number => TODAY - daysAgo * DAY + hours * HOUR

interface Seed {
  daysAgo: number
  hour?: number
  contactId: string
  source: UsageEvent['source']
  inputTokens: number
  outputTokens: number
  cachedInputTokens?: number
  /** Codex reports token counts but no dollar figure — blueprint §3. */
  costUsd: number | null
}

// Spread over two weeks so the dashboard's time axis has something real to
// plot. Shape is deliberate rather than random: Refactor Buddy's nightly
// routine is a steady baseline, the Code Reviewer spikes on the days work
// actually happened, and the marketing-site contact is nearly idle — that
// contrast is the point of the by-persona breakdown.
const SEEDS: Seed[] = [
  {
    daysAgo: 13,
    contactId: CONTACT_IDS.refactorBuddyPersonaRouter,
    source: 'routine',
    inputTokens: 8600,
    outputTokens: 940,
    costUsd: null
  },
  {
    daysAgo: 13,
    hour: 3,
    contactId: CONTACT_IDS.codeReviewerPersonaRouter,
    source: 'message',
    inputTokens: 3200,
    outputTokens: 540,
    cachedInputTokens: 2100,
    costUsd: 0.041
  },

  {
    daysAgo: 12,
    contactId: CONTACT_IDS.refactorBuddyPersonaRouter,
    source: 'routine',
    inputTokens: 9100,
    outputTokens: 1020,
    costUsd: null
  },

  {
    daysAgo: 11,
    contactId: CONTACT_IDS.refactorBuddyPersonaRouter,
    source: 'routine',
    inputTokens: 8800,
    outputTokens: 880,
    costUsd: null
  },
  {
    daysAgo: 11,
    hour: 5,
    contactId: CONTACT_IDS.docsWriterPersonaRouter,
    source: 'message',
    inputTokens: 4100,
    outputTokens: 1600,
    cachedInputTokens: 900,
    costUsd: 0.052
  },

  {
    daysAgo: 10,
    contactId: CONTACT_IDS.refactorBuddyPersonaRouter,
    source: 'routine',
    inputTokens: 9400,
    outputTokens: 1120,
    costUsd: null
  },
  {
    daysAgo: 10,
    hour: 2,
    contactId: CONTACT_IDS.codeReviewerPersonaRouter,
    source: 'message',
    inputTokens: 12400,
    outputTokens: 2180,
    cachedInputTokens: 8600,
    costUsd: 0.164
  },
  {
    daysAgo: 10,
    hour: 4,
    contactId: CONTACT_IDS.codeReviewerPersonaRouter,
    source: 'message',
    inputTokens: 6800,
    outputTokens: 1240,
    cachedInputTokens: 5100,
    costUsd: 0.089
  },

  {
    daysAgo: 9,
    contactId: CONTACT_IDS.refactorBuddyPersonaRouter,
    source: 'routine',
    inputTokens: 8200,
    outputTokens: 760,
    costUsd: null
  },
  {
    daysAgo: 9,
    hour: 6,
    contactId: CONTACT_IDS.codeReviewerMarketingSite,
    source: 'message',
    inputTokens: 1800,
    outputTokens: 320,
    costUsd: 0.019
  },

  {
    daysAgo: 8,
    contactId: CONTACT_IDS.refactorBuddyPersonaRouter,
    source: 'routine',
    inputTokens: 8900,
    outputTokens: 980,
    costUsd: null
  },

  {
    daysAgo: 7,
    contactId: CONTACT_IDS.refactorBuddyPersonaRouter,
    source: 'routine',
    inputTokens: 9800,
    outputTokens: 1340,
    costUsd: null
  },
  {
    daysAgo: 7,
    hour: 3,
    contactId: CONTACT_IDS.docsWriterPersonaRouter,
    source: 'message',
    inputTokens: 5200,
    outputTokens: 2400,
    cachedInputTokens: 1200,
    costUsd: 0.071
  },

  {
    daysAgo: 6,
    contactId: CONTACT_IDS.refactorBuddyPersonaRouter,
    source: 'routine',
    inputTokens: 8400,
    outputTokens: 820,
    costUsd: null
  },
  {
    daysAgo: 6,
    hour: 7,
    contactId: CONTACT_IDS.codeReviewerPersonaRouter,
    source: 'message',
    inputTokens: 9600,
    outputTokens: 1680,
    cachedInputTokens: 7200,
    costUsd: 0.127
  },

  {
    daysAgo: 5,
    contactId: CONTACT_IDS.refactorBuddyPersonaRouter,
    source: 'routine',
    inputTokens: 9000,
    outputTokens: 1060,
    costUsd: null
  },

  {
    daysAgo: 4,
    contactId: CONTACT_IDS.refactorBuddyPersonaRouter,
    source: 'routine',
    inputTokens: 11200,
    outputTokens: 1820,
    costUsd: null
  },
  {
    daysAgo: 4,
    hour: 2,
    contactId: CONTACT_IDS.codeReviewerPersonaRouter,
    source: 'message',
    inputTokens: 15800,
    outputTokens: 2960,
    cachedInputTokens: 11400,
    costUsd: 0.212
  },
  {
    daysAgo: 4,
    hour: 5,
    contactId: CONTACT_IDS.docsWriterPersonaRouter,
    source: 'message',
    inputTokens: 3400,
    outputTokens: 1180,
    cachedInputTokens: 800,
    costUsd: 0.044
  },

  {
    daysAgo: 3,
    contactId: CONTACT_IDS.refactorBuddyPersonaRouter,
    source: 'routine',
    inputTokens: 8700,
    outputTokens: 900,
    costUsd: null
  },
  {
    daysAgo: 3,
    hour: 4,
    contactId: CONTACT_IDS.codeReviewerMarketingSite,
    source: 'message',
    inputTokens: 2200,
    outputTokens: 460,
    costUsd: 0.026
  },

  {
    daysAgo: 2,
    contactId: CONTACT_IDS.refactorBuddyPersonaRouter,
    source: 'routine',
    inputTokens: 9300,
    outputTokens: 1140,
    costUsd: null
  },
  {
    daysAgo: 2,
    hour: 3,
    contactId: CONTACT_IDS.codeReviewerPersonaRouter,
    source: 'message',
    inputTokens: 7400,
    outputTokens: 1320,
    cachedInputTokens: 5600,
    costUsd: 0.098
  },

  {
    daysAgo: 1,
    contactId: CONTACT_IDS.refactorBuddyPersonaRouter,
    source: 'routine',
    inputTokens: 10100,
    outputTokens: 1460,
    costUsd: null
  },
  {
    daysAgo: 1,
    hour: 6,
    contactId: CONTACT_IDS.docsWriterPersonaRouter,
    source: 'message',
    inputTokens: 4600,
    outputTokens: 1920,
    cachedInputTokens: 1100,
    costUsd: 0.061
  },

  {
    daysAgo: 0,
    contactId: CONTACT_IDS.refactorBuddyPersonaRouter,
    source: 'routine',
    inputTokens: 9600,
    outputTokens: 1240,
    costUsd: null
  },
  {
    daysAgo: 0,
    hour: 1,
    contactId: CONTACT_IDS.codeReviewerPersonaRouter,
    source: 'message',
    inputTokens: 11200,
    outputTokens: 1980,
    cachedInputTokens: 8400,
    costUsd: 0.148
  }
]

export const usageEvents: UsageEvent[] = SEEDS.map((seed, index) => ({
  id: `usage-${index + 1}`,
  contactId: seed.contactId,
  timestamp: day(seed.daysAgo, seed.hour ?? 0),
  source: seed.source,
  inputTokens: seed.inputTokens,
  outputTokens: seed.outputTokens,
  ...(seed.cachedInputTokens !== undefined ? { cachedInputTokens: seed.cachedInputTokens } : {}),
  costUsd: seed.costUsd
}))
