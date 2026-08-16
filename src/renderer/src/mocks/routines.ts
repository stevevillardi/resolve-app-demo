import type { Routine } from '@/types'
import { CONTACT_IDS } from './contacts'

const BASE_TIME = Date.parse('2026-08-15T09:00:00Z')

export const routines: Routine[] = [
  {
    id: 'routine-1',
    contactId: CONTACT_IDS.refactorBuddyPersonaRouter,
    schedule: '0 9 * * *',
    prompt: 'Check for newly reported issues daily and fix the trivial ones.',
    enabled: true,
    lastRunAt: BASE_TIME,
    lastRunSummary: 'Fixed 2 lint issues in utils/format.ts.'
  },
  {
    id: 'routine-2',
    contactId: CONTACT_IDS.codeReviewerPersonaRouter,
    schedule: '0 */6 * * *',
    prompt: 'Review any PRs opened in the last 6 hours.',
    enabled: false,
    lastRunAt: null,
    lastRunSummary: null
  }
]
