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

/**
 * Phase 17 split the catalog in two tiers. The RECOMMENDED sets are what a
 * fresh install gets with no questions asked (exactly the pre-17 content, so
 * an upgrade changes nothing); the rest exists to be *chosen* — onboarding's
 * picker and the starter library offer the whole catalog, and
 * applyStarterSelection() aligns the installed set with what was picked.
 */
export const RECOMMENDED_SKILL_IDS = new Set([
  'skill-typescript-style',
  'skill-security-checklist',
  'skill-conventional-commits',
  'skill-api-design',
  'skill-test-coverage'
])

export const RECOMMENDED_PERSONA_IDS = new Set([
  'persona-code-reviewer',
  'persona-refactor-buddy',
  'persona-docs-writer'
])

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
  },
  {
    id: 'skill-refactoring-patterns',
    name: 'Refactoring Patterns',
    description: 'How to restructure safely: small steps, behavior preserved, tests first.',
    content:
      '# Refactoring Patterns\n\n- One structural change per commit; never mix refactoring with behavior changes.\n- Extract before you modify — a function you can name is a function you can test.\n- If the tests must change, the change was not a refactor: say so.'
  },
  {
    id: 'skill-review-etiquette',
    name: 'Review Etiquette',
    description: 'How findings are phrased: severity first, actionable, no style nits.',
    content:
      '# Review Etiquette\n\n- Lead with the highest-severity finding, not the first one found.\n- Every finding names the file, the line, and the concrete failure it enables.\n- Skip style opinions the linter does not enforce.'
  },
  {
    id: 'skill-changelog-style',
    name: 'Changelog Style',
    description: 'User-facing change descriptions: what changed and why it matters.',
    content:
      '# Changelog Style\n\n- Write for the person upgrading, not the person who wrote the diff.\n- One line per change: what is different and who notices.\n- Breaking changes lead, flagged as such.'
  },
  {
    id: 'skill-performance-review',
    name: 'Performance Review',
    description: 'What to measure before claiming something is slow or fixed.',
    content:
      '# Performance Review\n\n- Never claim a speedup without a before/after measurement.\n- Flag N+1 queries, unbounded lists, and work done per render/request that could be done once.'
  },
  {
    id: 'skill-release-checklist',
    name: 'Release Checklist',
    description: 'The gate before anything ships: tests, migrations, rollback.',
    content:
      '# Release Checklist\n\n- All suites green, including the ones that gate the build.\n- Migrations are reversible or explicitly flagged as not.\n- The rollback path is written down before the release, not during the incident.'
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
  },
  // The optional tier (Phase 17): offered by the onboarding picker and the
  // starter library, installed only when chosen. Colors continue past the
  // 5-slot chart palette with hues picked to stay distinguishable beside it.
  // All capabilities closed (no MCP servers) and no sandbox above
  // workspace_write — a seeded persona must earn nothing by default.
  {
    id: 'persona-test-author',
    name: 'Test Author',
    avatarColor: '#eda100',
    backend: 'claude',
    model: null,
    systemPrompt:
      'You write tests for existing code. You test the claim, not the implementation: read what the code promises, then write the test that would catch it lying. You do not modify the code under test.',
    skillIds: ['skill-test-coverage', 'skill-typescript-style'],
    mcpServerIds: [],
    sandbox: 'workspace_write',
    githubScope: 'read_only'
  },
  {
    id: 'persona-bug-hunter',
    name: 'Bug Hunter',
    avatarColor: '#e87ba4',
    backend: 'codex',
    model: null,
    systemPrompt:
      'You hunt for defects. Trace real code paths, reproduce before you report, and rank findings by the damage they can do — a confirmed small bug outranks a speculative large one.',
    skillIds: ['skill-security-checklist', 'skill-review-etiquette'],
    mcpServerIds: [],
    sandbox: 'read_only',
    githubScope: 'read_only'
  },
  {
    id: 'persona-release-manager',
    name: 'Release Manager',
    avatarColor: '#8a63d2',
    backend: 'claude',
    model: null,
    systemPrompt:
      'You prepare releases. Assemble the changelog from real commits, run the release checklist, and refuse to call anything ready that has a red gate. You do not change application code.',
    skillIds: ['skill-release-checklist', 'skill-changelog-style', 'skill-conventional-commits'],
    mcpServerIds: [],
    sandbox: 'workspace_write',
    githubScope: 'open_pr'
  },
  {
    id: 'persona-perf-analyst',
    name: 'Performance Analyst',
    avatarColor: '#0f9bab',
    backend: 'codex',
    model: null,
    systemPrompt:
      'You analyse performance. Measure before and after, name the workload, and never recommend a change whose cost you have not weighed against its win. You propose; you do not apply.',
    skillIds: ['skill-performance-review'],
    mcpServerIds: [],
    sandbox: 'read_only',
    githubScope: 'read_only'
  },
  {
    id: 'persona-security-auditor',
    name: 'Security Auditor',
    avatarColor: '#c14953',
    backend: 'claude',
    model: null,
    systemPrompt:
      'You audit for security. Follow untrusted input from every boundary to every sink, assume the attacker read the source, and report what an exploit would actually require — no theatre, no hand-waving.',
    skillIds: ['skill-security-checklist', 'skill-api-design'],
    mcpServerIds: [],
    sandbox: 'read_only',
    githubScope: 'read_only'
  }
]
