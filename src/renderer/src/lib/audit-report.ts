import type { AuditScope } from '@/store/useUiStore'
import type { AuditAction, AuditActorKind, AuditEvent } from '@/types'

/**
 * The Activity dashboard's filtering, kept out of the dashboard — same split
 * as lib/usage-report.ts, and for the same reason: the renderer Vitest
 * project matches `*.test.ts` only, so logic worth testing has to live
 * outside a component.
 */

/** Every action recordAuditEvent can write, and what it reads as on screen. */
export const ACTION_LABELS: Record<AuditAction, string> = {
  contact_created: 'Contact created',
  contact_renamed: 'Contact renamed',
  contact_deleted: 'Contact deleted',
  contact_model_changed: 'Model changed',
  contact_isolation_changed: 'Isolation changed',
  contact_repo_trust_changed: 'Repo trust changed',
  contact_persona_rebound: 'Persona rebound',
  contact_recreated: 'Contact recreated',
  contact_session_reset: 'Session reset',
  repo_cloned: 'Repo cloned',
  pull_request_opened: 'Pull request opened',
  branch_merged: 'Branch merged',
  branch_committed: 'Branch committed',
  branch_discarded: 'Branch discarded',
  worktree_created: 'Worktree created',
  worktree_reconciled: 'Worktree reconciled'
}

export const ACTOR_LABELS: Record<AuditActorKind, string> = {
  user: 'You',
  routine: 'Routine',
  system: 'System'
}

export function actorLabel(event: Pick<AuditEvent, 'actorKind'>): string {
  return ACTOR_LABELS[event.actorKind]
}

/**
 * Whether an event belongs to a scope. Unlike usage-report's scopeFilter,
 * no Contact join is needed: an audit event always carries its own repoPath,
 * and contactId is the one column already meant to survive the Contact's
 * deletion (a deleted contact simply cannot be scoped to by id again, which
 * is correct — that history now belongs only to "all" and to its repo).
 */
export function auditScopeFilter(scope: AuditScope): (event: AuditEvent) => boolean {
  if (scope.kind === 'all') return () => true
  if (scope.kind === 'repo') return (event) => event.repoPath === scope.repoPath
  return (event) => event.contactId === scope.id
}

export interface AuditFilter {
  /** Inclusive lower bound, ms. Omit for "since the beginning". */
  from?: number
  /** Exclusive upper bound, ms. Omit for "up to now". */
  to?: number
  /** Keep only these actions. Omit for all. */
  actions?: AuditAction[]
  /** Keep only these actor kinds. Omit for all. */
  actorKinds?: AuditActorKind[]
}

export function filterAuditEvents(events: AuditEvent[], filter: AuditFilter = {}): AuditEvent[] {
  const { from, to, actions, actorKinds } = filter
  const allowedActions = actions ? new Set(actions) : null
  const allowedActorKinds = actorKinds ? new Set(actorKinds) : null

  return events.filter((event) => {
    if (from !== undefined && event.createdAt < from) return false
    if (to !== undefined && event.createdAt >= to) return false
    if (allowedActions && !allowedActions.has(event.action)) return false
    if (allowedActorKinds && !allowedActorKinds.has(event.actorKind)) return false
    return true
  })
}
