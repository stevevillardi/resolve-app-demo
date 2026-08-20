import { randomUUID } from 'crypto'
import { desc } from 'drizzle-orm'
import { initDb } from '../db'
import { toAuditEvent } from '../db/mappers'
import { auditEvents } from '../db/schema'
import { emitAuditChanged } from './agent-events'
import type { AuditAction, AuditEvent } from '../../shared/domain'

/**
 * Repo/contact governance history (Phase 27).
 *
 * One insert chokepoint, like recordUsage in usage-events.ts — every call
 * site below funnels through `recordAuditEvent`, so a new writer cannot
 * forget to stamp the actor or announce the change.
 */

/**
 * What triggered the action. Not TurnOrigin — see the schema comment in
 * shared/domain.ts for why. `user` is the default: the overwhelming majority
 * of call sites are reached only from a renderer-initiated IPC call.
 */
export type AuditActor = { kind: 'user' } | { kind: 'routine'; routineId: string } | { kind: 'system' }

const DEFAULT_ACTOR: AuditActor = { kind: 'user' }

export interface RecordAuditEventInput {
  action: AuditAction
  actor?: AuditActor
  /** Null when the action has no Contact to attribute yet, e.g. a fresh clone. */
  contactId?: string | null
  repoPath: string
  personaTemplateId?: string | null
  /** A precomputed human-readable line — see the schema comment for why. */
  summary: string
  metadata?: Record<string, unknown> | null
}

export function recordAuditEvent(input: RecordAuditEventInput): AuditEvent {
  const actor = input.actor ?? DEFAULT_ACTOR
  const actorRoutineId = actor.kind === 'routine' ? actor.routineId : null

  const event: AuditEvent = {
    id: randomUUID(),
    createdAt: Date.now(),
    action: input.action,
    actorKind: actor.kind,
    ...(actorRoutineId ? { actorRoutineId } : {}),
    contactId: input.contactId ?? null,
    repoPath: input.repoPath,
    ...(input.personaTemplateId ? { personaTemplateId: input.personaTemplateId } : {}),
    summary: input.summary,
    ...(input.metadata ? { metadata: input.metadata } : {})
  }

  initDb()
    .insert(auditEvents)
    .values({
      id: event.id,
      createdAt: new Date(event.createdAt),
      action: event.action,
      actorKind: event.actorKind,
      actorRoutineId,
      contactId: event.contactId,
      repoPath: event.repoPath,
      personaTemplateId: input.personaTemplateId ?? null,
      summary: event.summary,
      metadata: input.metadata ?? null
    })
    .run()

  // After the insert, never before — same ordering recordUsage uses, so a
  // renderer reacting to the push always finds the row already there.
  emitAuditChanged()

  return event
}

export function listAuditEvents(): AuditEvent[] {
  return initDb()
    .select()
    .from(auditEvents)
    .orderBy(desc(auditEvents.createdAt))
    .all()
    .map(toAuditEvent)
}
