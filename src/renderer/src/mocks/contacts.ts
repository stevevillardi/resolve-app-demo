import type { Contact } from '@/types'
import { PERSONA_TEMPLATE_IDS } from './personaTemplates'

export const REPO_PATHS = {
  personaRouter: '~/code/persona-router',
  marketingSite: '~/code/marketing-site'
} as const

export const CONTACT_IDS = {
  codeReviewerPersonaRouter: 'contact-code-reviewer-persona-router',
  refactorBuddyPersonaRouter: 'contact-refactor-buddy-persona-router',
  codeReviewerMarketingSite: 'contact-code-reviewer-marketing-site',
  docsWriterPersonaRouter: 'contact-docs-writer-persona-router'
} as const

/**
 * Readers stay in the main tree and writers get a worktree, which is what
 * defaultIsolation() does for real — so Refactor Buddy is the only one of these
 * four with a branch of its own.
 */
export const contacts: Contact[] = [
  {
    id: CONTACT_IDS.codeReviewerPersonaRouter,
    personaTemplateId: PERSONA_TEMPLATE_IDS.codeReviewer,
    repoPath: REPO_PATHS.personaRouter,
    displayName: 'Code Reviewer · persona-router',
    backendSessionId: 'sess_cr_pr_001',
    worktreePath: null,
    branch: null,
    isolation: 'shared'
  },
  {
    id: CONTACT_IDS.refactorBuddyPersonaRouter,
    personaTemplateId: PERSONA_TEMPLATE_IDS.refactorBuddy,
    repoPath: REPO_PATHS.personaRouter,
    displayName: 'Refactor Buddy · persona-router',
    backendSessionId: 'sess_rb_pr_001',
    worktreePath:
      '~/Library/Application Support/persona-router/worktrees/persona-router/refactor-buddy-cont',
    branch: 'persona/refactor-buddy-cont',
    isolation: 'worktree'
  },
  {
    id: CONTACT_IDS.codeReviewerMarketingSite,
    personaTemplateId: PERSONA_TEMPLATE_IDS.codeReviewer,
    repoPath: REPO_PATHS.marketingSite,
    displayName: 'Code Reviewer · marketing-site',
    backendSessionId: null,
    worktreePath: null,
    branch: null,
    isolation: 'shared'
  },
  {
    id: CONTACT_IDS.docsWriterPersonaRouter,
    personaTemplateId: PERSONA_TEMPLATE_IDS.docsWriter,
    repoPath: REPO_PATHS.personaRouter,
    displayName: 'Docs Writer · persona-router',
    backendSessionId: 'sess_dw_pr_001',
    worktreePath: null,
    branch: null,
    isolation: 'shared'
  }
]
