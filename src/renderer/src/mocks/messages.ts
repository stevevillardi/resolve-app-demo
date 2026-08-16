import type { Message } from '@/types'
import { CONTACT_IDS } from './contacts'
import { CODE_REVIEW_MARKDOWN, REFACTOR_STREAMING_MARKDOWN } from './markdownSamples'

const BASE_TIME = Date.parse('2026-08-15T14:00:00Z')

export const messages: Message[] = [
  // Code Reviewer · persona-router — the "golden path" thread (Journey 1)
  {
    id: 'msg-cr-1',
    contactId: CONTACT_IDS.codeReviewerPersonaRouter,
    role: 'user',
    content: 'Review the changes in auth.ts before I open a PR.',
    timestamp: BASE_TIME
  },
  {
    id: 'msg-cr-2',
    contactId: CONTACT_IDS.codeReviewerPersonaRouter,
    role: 'assistant',
    content: CODE_REVIEW_MARKDOWN,
    timestamp: BASE_TIME + 45_000,
    status: 'sent'
  },

  // Refactor Buddy · persona-router — mid-stream state, demonstrates StreamingIndicator (codex)
  {
    id: 'msg-rb-1',
    contactId: CONTACT_IDS.refactorBuddyPersonaRouter,
    role: 'user',
    content: 'Rename fetchStuff to something descriptive across the repo.',
    timestamp: BASE_TIME + 3_600_000
  },
  {
    id: 'msg-rb-2',
    contactId: CONTACT_IDS.refactorBuddyPersonaRouter,
    role: 'assistant',
    content: REFACTOR_STREAMING_MARKDOWN,
    timestamp: BASE_TIME + 3_601_000,
    status: 'streaming'
  },

  // Docs Writer · persona-router — error state, demonstrates MessageBubble error variant
  {
    id: 'msg-dw-1',
    contactId: CONTACT_IDS.docsWriterPersonaRouter,
    role: 'user',
    content: 'Update the README install steps for the new npm scripts.',
    timestamp: BASE_TIME + 7_200_000
  },
  {
    id: 'msg-dw-2',
    contactId: CONTACT_IDS.docsWriterPersonaRouter,
    role: 'assistant',
    content: '',
    timestamp: BASE_TIME + 7_205_000,
    status: 'error',
    error: {
      kind: 'rate_limit',
      message: 'Claude API rate limit reached. Retrying in a moment will usually resolve this.'
    }
  },

  // Code Reviewer · marketing-site — short thread, no session yet
  {
    id: 'msg-cr2-1',
    contactId: CONTACT_IDS.codeReviewerMarketingSite,
    role: 'user',
    content: 'Take a look at the new pricing page component when you get a chance.',
    timestamp: BASE_TIME + 10_800_000
  }
]
