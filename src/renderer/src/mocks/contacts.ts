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

export const contacts: Contact[] = [
  {
    id: CONTACT_IDS.codeReviewerPersonaRouter,
    personaTemplateId: PERSONA_TEMPLATE_IDS.codeReviewer,
    repoPath: REPO_PATHS.personaRouter,
    displayName: 'Code Reviewer · persona-router',
    backendSessionId: 'sess_cr_pr_001'
  },
  {
    id: CONTACT_IDS.refactorBuddyPersonaRouter,
    personaTemplateId: PERSONA_TEMPLATE_IDS.refactorBuddy,
    repoPath: REPO_PATHS.personaRouter,
    displayName: 'Refactor Buddy · persona-router',
    backendSessionId: 'sess_rb_pr_001'
  },
  {
    id: CONTACT_IDS.codeReviewerMarketingSite,
    personaTemplateId: PERSONA_TEMPLATE_IDS.codeReviewer,
    repoPath: REPO_PATHS.marketingSite,
    displayName: 'Code Reviewer · marketing-site',
    backendSessionId: null
  },
  {
    id: CONTACT_IDS.docsWriterPersonaRouter,
    personaTemplateId: PERSONA_TEMPLATE_IDS.docsWriter,
    repoPath: REPO_PATHS.personaRouter,
    displayName: 'Docs Writer · persona-router',
    backendSessionId: 'sess_dw_pr_001'
  }
]
