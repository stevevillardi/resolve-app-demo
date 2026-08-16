import type { Group, GroupMessage } from '@/types'
import { CONTACT_IDS, REPO_PATHS } from './contacts'

export const GROUP_IDS = {
  personaRouter: 'group-persona-router',
  marketingSite: 'group-marketing-site'
} as const

export const groups: Group[] = [
  { id: GROUP_IDS.personaRouter, repoPath: REPO_PATHS.personaRouter },
  { id: GROUP_IDS.marketingSite, repoPath: REPO_PATHS.marketingSite }
]

const BASE_TIME = Date.parse('2026-08-15T09:00:00Z')

export const groupMessages: GroupMessage[] = [
  // routine_run — least-recent, sets the scene
  {
    id: 'gm-1',
    groupId: GROUP_IDS.personaRouter,
    timestamp: BASE_TIME,
    type: 'routine_run',
    contactId: CONTACT_IDS.refactorBuddyPersonaRouter,
    content: 'Daily sweep found 2 trivial lint issues in utils/format.ts and fixed them.'
  },
  // system_summary, decision — durable, always injected
  {
    id: 'gm-2',
    groupId: GROUP_IDS.personaRouter,
    timestamp: BASE_TIME + 60_000,
    type: 'system_summary',
    contactId: CONTACT_IDS.refactorBuddyPersonaRouter,
    content:
      'Renamed fetchStuff → fetchWorkspaceIssues across the repo. Rationale: the old name gave no indication of what it fetched or from where.',
    category: 'decision',
    durable: true
  },
  // system_summary, tradeoff — also durable
  {
    id: 'gm-3',
    groupId: GROUP_IDS.personaRouter,
    timestamp: BASE_TIME + 120_000,
    type: 'system_summary',
    contactId: CONTACT_IDS.refactorBuddyPersonaRouter,
    content:
      'Considered extracting a shared HTTP client but held off — only 2 call sites exist today, not worth the abstraction yet.',
    category: 'tradeoff',
    durable: true
  },
  // user_mention — outbound @mention
  {
    id: 'gm-4',
    groupId: GROUP_IDS.personaRouter,
    timestamp: BASE_TIME + 180_000,
    type: 'user_mention',
    content: '@Code Reviewer take a look at the fetchWorkspaceIssues rename when you have a sec.'
  },
  // agent_reply — routed response to the mention
  {
    id: 'gm-5',
    groupId: GROUP_IDS.personaRouter,
    timestamp: BASE_TIME + 240_000,
    type: 'agent_reply',
    contactId: CONTACT_IDS.codeReviewerPersonaRouter,
    content:
      'Looked at the rename — clean, and all call sites updated. No objections. Nice that the summary already gave me the rationale before I asked.'
  },
  // second routine_run, non-durable summary category
  {
    id: 'gm-6',
    groupId: GROUP_IDS.personaRouter,
    timestamp: BASE_TIME + 300_000,
    type: 'system_summary',
    contactId: CONTACT_IDS.refactorBuddyPersonaRouter,
    content:
      'Routine run: checked for newly reported issues, nothing trivial enough to auto-fix today.',
    category: 'routine',
    durable: false
  },

  // marketing-site group — lighter thread
  {
    id: 'gm-7',
    groupId: GROUP_IDS.marketingSite,
    timestamp: BASE_TIME + 3_600_000,
    type: 'user_mention',
    content: '@Code Reviewer thoughts on the new pricing page component?'
  },
  {
    id: 'gm-8',
    groupId: GROUP_IDS.marketingSite,
    timestamp: BASE_TIME + 3_660_000,
    type: 'agent_reply',
    contactId: CONTACT_IDS.codeReviewerMarketingSite,
    content: "Structure looks fine. One nit: the CTA button doesn't have a focus-visible state."
  }
]
