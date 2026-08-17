import type { InferSelectModel } from 'drizzle-orm'
import type {
  Contact,
  Group,
  GroupMessage,
  PersistedMessage,
  PersonaTemplate,
  Routine,
  Skill,
  UsageEvent
} from '../../shared/domain'
import type {
  contacts,
  groupMessages,
  groups,
  messages,
  personaTemplates,
  routines,
  skills,
  usageEvents
} from './schema'

/**
 * Row → domain. Two mismatches to reconcile, both deliberate:
 *
 * 1. Drizzle's `timestamp_ms` mode hands back a `Date`; the domain (and so the
 *    IPC boundary, and so the renderer) speaks epoch milliseconds. Converting
 *    here means nothing outside main ever has to know a Date was involved.
 * 2. SQLite has no "absent" — an unset column is null. The domain models
 *    genuinely optional fields as optional rather than nullable, so null
 *    becomes an omitted key. The exceptions are the three fields blueprint §4
 *    defines as explicitly nullable (`backendSessionId`, `lastRunAt`,
 *    `lastRunSummary`, `costUsd`), where null is a meaningful value — "no
 *    session yet" is not the same as "unknown".
 */

type SkillRow = InferSelectModel<typeof skills>
type PersonaTemplateRow = InferSelectModel<typeof personaTemplates>
type ContactRow = InferSelectModel<typeof contacts>
type GroupRow = InferSelectModel<typeof groups>
type GroupMessageRow = InferSelectModel<typeof groupMessages>
type MessageRow = InferSelectModel<typeof messages>
type RoutineRow = InferSelectModel<typeof routines>
type UsageEventRow = InferSelectModel<typeof usageEvents>

/** Spreads to `{ key: value }` when set, or to nothing at all when null. */
function optional<K extends string, V>(key: K, value: V | null): { [P in K]?: V } {
  return (value === null ? {} : { [key]: value }) as { [P in K]?: V }
}

export function toSkill(row: SkillRow): Skill {
  return { id: row.id, name: row.name, description: row.description, content: row.content }
}

export function toPersonaTemplate(row: PersonaTemplateRow): PersonaTemplate {
  return {
    id: row.id,
    name: row.name,
    avatarColor: row.avatarColor,
    backend: row.backend,
    // Nullable rather than optional: "use the backend default" is a choice the
    // user can make, not an absent value.
    model: row.model,
    systemPrompt: row.systemPrompt,
    skillIds: row.skillIds,
    // Null coalesced to [] rather than passed through: unlike `model` above,
    // "no servers" and "not set" are the same thing, and the domain type is an
    // array so every consumer can iterate without a guard.
    mcpServerIds: row.mcpServerIds ?? [],
    sandbox: row.sandbox,
    githubScope: row.githubScope
  }
}

export function toContact(row: ContactRow): Contact {
  return {
    id: row.id,
    personaTemplateId: row.personaTemplateId,
    repoPath: row.repoPath,
    displayName: row.displayName,
    backendSessionId: row.backendSessionId,
    // Passed straight through rather than run through optional(): for all three
    // of these null is a meaning, not an absence. workingPathFor() reads
    // `worktreePath ?? repoPath`, which only says what it looks like it says if
    // the key is always present.
    worktreePath: row.worktreePath,
    branch: row.branch,
    isolation: row.isolation,
    // Null on purpose, and read through repoTrustOf(): the difference between
    // "trusts nothing" and "was never asked" is worth keeping, because the UI
    // shows a first-time prompt for one and a settled state for the other.
    repoTrust: row.repoTrust,
    lastReadAt: row.lastReadAt === null ? null : row.lastReadAt.getTime()
  }
}

export function toGroup(row: GroupRow): Group {
  return {
    id: row.id,
    repoPath: row.repoPath,
    lastReadAt: row.lastReadAt === null ? null : row.lastReadAt.getTime()
  }
}

export function toGroupMessage(row: GroupMessageRow): GroupMessage {
  return {
    id: row.id,
    groupId: row.groupId,
    timestamp: row.timestamp.getTime(),
    type: row.type,
    content: row.content,
    ...optional('contactId', row.contactId),
    ...optional('category', row.category),
    ...optional('durable', row.durable),
    ...optional('branch', row.branch),
    ...optional('resolvedAt', row.resolvedAt === null ? null : row.resolvedAt.getTime())
  }
}

export function toMessage(row: MessageRow): PersistedMessage {
  return {
    id: row.id,
    contactId: row.contactId,
    role: row.role,
    content: row.content,
    timestamp: row.timestamp.getTime(),
    ...optional('work', row.work)
  }
}

export function toRoutine(row: RoutineRow): Routine {
  return {
    id: row.id,
    contactId: row.contactId,
    schedule: row.schedule,
    prompt: row.prompt,
    enabled: row.enabled,
    lastRunAt: row.lastRunAt === null ? null : row.lastRunAt.getTime(),
    lastRunSummary: row.lastRunSummary,
    missedRunCount: row.missedRunCount,
    lastMissedAt: row.lastMissedAt === null ? null : row.lastMissedAt.getTime(),
    monthlyBudgetUsd: row.monthlyBudgetUsd
  }
}

export function toUsageEvent(row: UsageEventRow): UsageEvent {
  return {
    id: row.id,
    // Passed through as null rather than omitted: "belonged to a Contact that
    // no longer exists" is a meaning, the same way costUsd's null is.
    contactId: row.contactId,
    ...optional('personaTemplateId', row.personaTemplateId),
    ...optional('repoPath', row.repoPath),
    ...optional('routineId', row.routineId),
    timestamp: row.timestamp.getTime(),
    source: row.source,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    costUsd: row.costUsd,
    ...optional('cachedInputTokens', row.cachedInputTokens),
    ...optional('cacheWriteInputTokens', row.cacheWriteInputTokens),
    ...optional('reasoningOutputTokens', row.reasoningOutputTokens),
    ...optional('model', row.model),
    ...optional('costSource', row.costSource),
    ...optional('sessionId', row.sessionId)
  }
}
