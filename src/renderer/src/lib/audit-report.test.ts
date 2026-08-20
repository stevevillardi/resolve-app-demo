import { describe, expect, it } from 'vitest'
import {
  ACTION_LABELS,
  actorLabel,
  auditScopeFilter,
  filterAuditEvents,
  type AuditFilter
} from './audit-report'
import type { AuditAction, AuditEvent } from '@/types'

const AUDIT_ACTIONS: AuditAction[] = [
  'contact_created',
  'contact_renamed',
  'contact_deleted',
  'contact_model_changed',
  'contact_isolation_changed',
  'contact_repo_trust_changed',
  'contact_persona_rebound',
  'contact_recreated',
  'contact_session_reset',
  'repo_cloned',
  'pull_request_opened',
  'branch_merged',
  'branch_committed',
  'branch_discarded',
  'worktree_created',
  'worktree_reconciled'
]

function event(overrides: Partial<AuditEvent> = {}): AuditEvent {
  return {
    id: 'a1',
    createdAt: 1_700_000_000_000,
    action: 'contact_renamed',
    actorKind: 'user',
    contactId: 'c1',
    repoPath: '~/code/app',
    summary: 'Renamed Reviewer to Senior Reviewer',
    ...overrides
  }
}

describe('ACTION_LABELS', () => {
  it('has a non-empty label for every action a real event can carry', () => {
    // Belt-and-suspenders alongside the Record<AuditAction, string> type: a
    // future action added to the union fails the type first, but this catches
    // an empty-string placeholder that would still typecheck.
    for (const action of AUDIT_ACTIONS) {
      expect(ACTION_LABELS[action], action).toBeTruthy()
    }
  })
})

describe('actorLabel', () => {
  it('reads the three actor kinds as a person would expect', () => {
    expect(actorLabel({ actorKind: 'user' })).toBe('You')
    expect(actorLabel({ actorKind: 'routine' })).toBe('Routine')
    expect(actorLabel({ actorKind: 'system' })).toBe('System')
  })
})

describe('auditScopeFilter', () => {
  const events = [
    event({ id: 'a1', repoPath: '~/code/app', contactId: 'c1' }),
    event({ id: 'a2', repoPath: '~/code/other', contactId: 'c2' }),
    // Outlives its Contact — the FK is set null on delete.
    event({ id: 'a3', repoPath: '~/code/app', contactId: null })
  ]

  it('keeps everything for "all"', () => {
    expect(events.filter(auditScopeFilter({ kind: 'all' })).map((e) => e.id)).toEqual([
      'a1',
      'a2',
      'a3'
    ])
  })

  it('scopes to a repo, including rows whose contact is gone', () => {
    expect(
      events.filter(auditScopeFilter({ kind: 'repo', repoPath: '~/code/app' })).map((e) => e.id)
    ).toEqual(['a1', 'a3'])
  })

  it('scopes to a contact, which a deleted contact can no longer match', () => {
    expect(events.filter(auditScopeFilter({ kind: 'contact', id: 'c1' })).map((e) => e.id)).toEqual(
      ['a1']
    )
  })
})

describe('filterAuditEvents', () => {
  const events = [
    event({ id: 'old', createdAt: 1_000, action: 'contact_created', actorKind: 'user' }),
    event({ id: 'mid', createdAt: 2_000, action: 'branch_merged', actorKind: 'routine' }),
    event({ id: 'new', createdAt: 3_000, action: 'contact_deleted', actorKind: 'system' })
  ]

  it('returns everything with no filter', () => {
    expect(filterAuditEvents(events).map((e) => e.id)).toEqual(['old', 'mid', 'new'])
  })

  it('applies an inclusive lower and exclusive upper time bound', () => {
    const filter: AuditFilter = { from: 1_000, to: 3_000 }
    expect(filterAuditEvents(events, filter).map((e) => e.id)).toEqual(['old', 'mid'])
  })

  it('keeps only the listed actions', () => {
    const filter: AuditFilter = { actions: ['branch_merged'] }
    expect(filterAuditEvents(events, filter).map((e) => e.id)).toEqual(['mid'])
  })

  it('keeps only the listed actor kinds', () => {
    const filter: AuditFilter = { actorKinds: ['routine', 'system'] }
    expect(filterAuditEvents(events, filter).map((e) => e.id)).toEqual(['mid', 'new'])
  })

  it('composes multiple filters', () => {
    const filter: AuditFilter = { from: 1_500, actorKinds: ['system'] }
    expect(filterAuditEvents(events, filter).map((e) => e.id)).toEqual(['new'])
  })
})
