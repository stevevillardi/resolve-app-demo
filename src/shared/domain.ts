import { z } from 'zod'

/**
 * The blueprint §4 data model, as Zod schemas — the single definition both
 * processes compile against. Main persists these shapes (src/main/db/schema.ts
 * mirrors them column-for-column), the IPC contract validates them at the
 * boundary, and the renderer re-exports the inferred types from `@/types`.
 *
 * Timestamps are epoch milliseconds on the wire. SQLite stores them as
 * integers and Drizzle hands back `Date`, so src/main/db/mappers.ts converts
 * at the service edge — nothing outside main ever sees a Date.
 */

// --- Enumerations -----------------------------------------------------------

export const personaBackendSchema = z.enum(['claude', 'codex'])
export const sandboxLevelSchema = z.enum(['read_only', 'workspace_write', 'full_access'])
export const githubScopeSchema = z.enum(['read_only', 'open_pr', 'full_access'])
export const messageRoleSchema = z.enum(['user', 'assistant'])
export const groupMessageTypeSchema = z.enum([
  'system_summary',
  'user_mention',
  'agent_reply',
  'routine_run'
])
export const systemSummaryCategorySchema = z.enum(['decision', 'tradeoff', 'routine'])
export const usageSourceSchema = z.enum(['message', 'routine'])

// --- Entities ---------------------------------------------------------------

export const skillSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  content: z.string()
})

export const personaTemplateSchema = z.object({
  id: z.string(),
  name: z.string(),
  avatarColor: z.string(),
  backend: personaBackendSchema,
  systemPrompt: z.string(),
  skillIds: z.array(z.string()),
  /** Two independent axes (blueprint §4): disk access and GitHub authority. */
  sandbox: sandboxLevelSchema,
  githubScope: githubScopeSchema
})

export const contactSchema = z.object({
  id: z.string(),
  personaTemplateId: z.string(),
  repoPath: z.string(),
  displayName: z.string(),
  /** Resume key for the backend session; null until the first turn runs. */
  backendSessionId: z.string().nullable()
})

export const groupSchema = z.object({
  id: z.string(),
  repoPath: z.string()
})

export const groupMessageSchema = z.object({
  id: z.string(),
  groupId: z.string(),
  timestamp: z.number(),
  type: groupMessageTypeSchema,
  /** Absent on `user_mention` — that one comes from the user, not a contact. */
  contactId: z.string().optional(),
  content: z.string(),
  /** `system_summary` only. */
  category: systemSummaryCategorySchema.optional(),
  /** `system_summary` only — durable entries are always re-injected (§6). */
  durable: z.boolean().optional()
})

/**
 * The persisted message. Blueprint §12 is deliberately just these five fields:
 * `status` and `error` describe an in-flight turn rather than a stored fact,
 * so they stay renderer-local (src/renderer/src/types/message.ts) and no
 * column is added for them.
 */
export const messageSchema = z.object({
  id: z.string(),
  contactId: z.string(),
  role: messageRoleSchema,
  content: z.string(),
  timestamp: z.number()
})

export const routineSchema = z.object({
  id: z.string(),
  contactId: z.string(),
  /** Cron expression. Validated where it's edited, not here. */
  schedule: z.string(),
  prompt: z.string(),
  enabled: z.boolean(),
  lastRunAt: z.number().nullable(),
  lastRunSummary: z.string().nullable()
})

export const usageEventSchema = z.object({
  id: z.string(),
  contactId: z.string(),
  timestamp: z.number(),
  source: usageSourceSchema,
  inputTokens: z.number(),
  outputTokens: z.number(),
  cachedInputTokens: z.number().optional(),
  /** Claude reports a figure; Codex doesn't, so it's computed or null (§3). */
  costUsd: z.number().nullable()
})

// --- Write shapes -----------------------------------------------------------
// Ids are minted in main with crypto.randomUUID(), never accepted from the
// renderer, so every create input omits `id`. Updates take a full entity
// minus nothing — the editors are whole-form saves, not partial patches.

export const skillDraftSchema = skillSchema.omit({ id: true })
export const personaTemplateDraftSchema = personaTemplateSchema.omit({ id: true })
export const contactDraftSchema = contactSchema.omit({ id: true, backendSessionId: true })

// --- Inferred types ---------------------------------------------------------

export type PersonaBackend = z.infer<typeof personaBackendSchema>
export type SandboxLevel = z.infer<typeof sandboxLevelSchema>
export type GithubScope = z.infer<typeof githubScopeSchema>
export type MessageRole = z.infer<typeof messageRoleSchema>
export type GroupMessageType = z.infer<typeof groupMessageTypeSchema>
export type SystemSummaryCategory = z.infer<typeof systemSummaryCategorySchema>
export type UsageSource = z.infer<typeof usageSourceSchema>

export type Skill = z.infer<typeof skillSchema>
export type PersonaTemplate = z.infer<typeof personaTemplateSchema>
export type Contact = z.infer<typeof contactSchema>
export type Group = z.infer<typeof groupSchema>
export type GroupMessage = z.infer<typeof groupMessageSchema>
export type PersistedMessage = z.infer<typeof messageSchema>
export type Routine = z.infer<typeof routineSchema>
export type UsageEvent = z.infer<typeof usageEventSchema>

export type SkillDraft = z.infer<typeof skillDraftSchema>
export type PersonaTemplateDraft = z.infer<typeof personaTemplateDraftSchema>
export type ContactDraft = z.infer<typeof contactDraftSchema>
