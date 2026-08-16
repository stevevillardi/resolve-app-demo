import type { PersonaTemplate, Skill } from '../../shared/domain'

/**
 * First-run defaults. Skills and personas only — both are library-level and
 * machine-independent, so seeding them is offering sensible starting content
 * rather than fabricating state. Contacts and Groups are deliberately absent:
 * they bind to a real local repo path, which nothing can know until the user
 * picks one (Phase 6).
 *
 * These mirror src/renderer/src/mocks/{skills,personaTemplates}.ts by content
 * but can't import them — main must not reach into the renderer. The ids are
 * kept identical on purpose: the surfaces still running on mock data
 * (UsageDashboard, UsageScopeList) join against persona ids, so matching them
 * keeps those screens coherent until Phase 10 replaces their data source.
 * Phase 8 took RoutineList off mocks. When the last mock consumer is gone, this
 * file becomes the only copy and the ids stop mattering.
 */

export const SEED_SKILLS: Skill[] = [
  {
    id: 'skill-typescript-style',
    name: 'TypeScript Style Guide',
    description: 'Project conventions for types, naming, and module structure.',
    content:
      '# TypeScript Style Guide\n\n- Prefer explicit return types on exported functions.\n- No `any` — use `unknown` and narrow.\n- One component per file outside `components/ui/**`.'
  },
  {
    id: 'skill-security-checklist',
    name: 'Security Checklist',
    description: 'Baseline checks for auth, input validation, and secret handling.',
    content:
      '# Security Checklist\n\n- Validate all external input with Zod.\n- Never log secrets or tokens.\n- Check for injection risk on any shell/SQL boundary.'
  },
  {
    id: 'skill-conventional-commits',
    name: 'Conventional Commits',
    description: 'Commit message format used across this repo.',
    content:
      '# Conventional Commits\n\n`type(scope): subject` — types: feat, fix, docs, refactor, build, chore.'
  },
  {
    id: 'skill-api-design',
    name: 'API Design Guidelines',
    description: 'Conventions for shaping IPC procedures and REST endpoints.',
    content:
      '# API Design Guidelines\n\n- Validate input/output at every boundary.\n- Prefer narrow, single-purpose procedures over broad ones.'
  },
  {
    id: 'skill-test-coverage',
    name: 'Test Coverage Standards',
    description: 'What must be covered before a change ships.',
    content:
      '# Test Coverage Standards\n\n- Cover the happy path and at least one failure mode per change.'
  }
]

// Avatar colours are the first three slots of the chart palette (see
// assets/main.css --chart-*), so a persona is the same colour in the sidebar
// and in the usage dashboard. They are CVD-validated as a set.
export const SEED_PERSONA_TEMPLATES: PersonaTemplate[] = [
  {
    id: 'persona-code-reviewer',
    name: 'Code Reviewer',
    avatarColor: '#2a78d6',
    backend: 'claude',
    model: null,
    systemPrompt:
      'You are a meticulous code reviewer. Read diffs carefully, flag correctness and security issues, and never edit files directly.',
    skillIds: ['skill-typescript-style', 'skill-security-checklist'],
    mcpServerIds: [],
    sandbox: 'read_only',
    githubScope: 'read_only'
  },
  {
    id: 'persona-refactor-buddy',
    name: 'Refactor Buddy',
    avatarColor: '#eb6834',
    backend: 'codex',
    model: null,
    systemPrompt:
      'You are a refactoring specialist. Make small, well-reasoned structural improvements and always explain your rationale.',
    skillIds: ['skill-typescript-style', 'skill-conventional-commits'],
    mcpServerIds: [],
    sandbox: 'workspace_write',
    githubScope: 'open_pr'
  },
  {
    id: 'persona-docs-writer',
    name: 'Docs Writer',
    avatarColor: '#1baf7a',
    backend: 'claude',
    model: null,
    systemPrompt: 'You keep documentation accurate and readable. You do not modify source code.',
    skillIds: ['skill-conventional-commits'],
    mcpServerIds: [],
    sandbox: 'read_only',
    githubScope: 'read_only'
  }
]
