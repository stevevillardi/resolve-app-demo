import type { Skill } from '@/types'

export const skills: Skill[] = [
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
