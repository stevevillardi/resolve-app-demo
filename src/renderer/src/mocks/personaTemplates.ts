import type { PersonaTemplate } from '@/types'

// Avatar colours are the first three slots of the chart palette (see
// assets/main.css --chart-*), so a persona is the same colour in the sidebar
// and in the usage dashboard. They are CVD-validated as a set.

export const PERSONA_TEMPLATE_IDS = {
  codeReviewer: 'persona-code-reviewer',
  refactorBuddy: 'persona-refactor-buddy',
  docsWriter: 'persona-docs-writer'
} as const

export const personaTemplates: PersonaTemplate[] = [
  {
    id: PERSONA_TEMPLATE_IDS.codeReviewer,
    name: 'Code Reviewer',
    avatarColor: '#2a78d6',
    backend: 'claude',
    model: null,
    systemPrompt:
      'You are a meticulous code reviewer. Read diffs carefully, flag correctness and security issues, and never edit files directly.',
    skillIds: ['skill-typescript-style', 'skill-security-checklist'],
    sandbox: 'read_only',
    githubScope: 'read_only'
  },
  {
    id: PERSONA_TEMPLATE_IDS.refactorBuddy,
    name: 'Refactor Buddy',
    avatarColor: '#eb6834',
    backend: 'codex',
    model: null,
    systemPrompt:
      'You are a refactoring specialist. Make small, well-reasoned structural improvements and always explain your rationale.',
    skillIds: ['skill-typescript-style', 'skill-conventional-commits'],
    sandbox: 'workspace_write',
    githubScope: 'open_pr'
  },
  {
    id: PERSONA_TEMPLATE_IDS.docsWriter,
    name: 'Docs Writer',
    avatarColor: '#1baf7a',
    backend: 'claude',
    model: null,
    systemPrompt: 'You keep documentation accurate and readable. You do not modify source code.',
    skillIds: ['skill-conventional-commits'],
    sandbox: 'read_only',
    githubScope: 'read_only'
  }
]
