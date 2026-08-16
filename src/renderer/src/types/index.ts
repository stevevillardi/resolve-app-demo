/**
 * The domain model now lives in src/shared/domain.ts as Zod schemas, so main's
 * tables, the IPC contract, and these types are all one definition rather than
 * three that have to be kept in agreement by hand.
 *
 * This file stays as the renderer's entry point so `@/types` keeps working
 * everywhere it's already imported.
 */
export type {
  PersonaBackend,
  SandboxLevel,
  GithubScope,
  MessageRole,
  GroupMessageType,
  SystemSummaryCategory,
  UsageSource,
  Skill,
  PersonaTemplate,
  Contact,
  Group,
  GroupMessage,
  Routine,
  UsageEvent,
  SkillDraft,
  PersonaTemplateDraft,
  ContactDraft
} from '../../../shared/domain'

// Renderer-only: adds the in-flight turn state that isn't persisted.
export * from './message'

export * from './usage-summary'
