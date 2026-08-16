import { z } from 'zod'
import {
  contactDraftSchema,
  contactSchema,
  groupSchema,
  messageSchema,
  personaBackendSchema,
  personaTemplateDraftSchema,
  personaTemplateSchema,
  skillDraftSchema,
  skillSchema,
  usageEventSchema
} from './domain'

/**
 * Single source of truth for main<->renderer IPC. Every procedure has an
 * input/output Zod schema, validated on both sides of the boundary by
 * registerProcedure() (main) and callProcedure() (renderer).
 *
 * Replaces electron-trpc, which was verified stale/incompatible with this
 * toolchain during Phase 1 planning — see docs/plan/00-progress.md.
 */

/**
 * Codex and GitHub both authenticate by showing the user a short code to type
 * into a browser, so they share one state shape and one renderer component.
 *
 * `starting` covers the gap between the user clicking Connect and the provider
 * handing back a code — a second or two for GitHub, longer for Codex, which has
 * to spawn a ~200MB binary first.
 */
export const deviceFlowStateSchema = z.object({
  status: z.enum(['idle', 'starting', 'awaiting_authorization', 'success', 'error']),
  userCode: z.string().optional(),
  verificationUri: z.string().optional(),
  /** Epoch ms. Absent when the provider doesn't tell us. */
  expiresAt: z.number().optional(),
  error: z.string().optional()
})

const claudeStatusSchema = z.object({
  authenticated: z.boolean(),
  /** How we got in: reused Claude Code CLI auth, or a key the user gave us. */
  source: z.enum(['cli', 'api_key']).nullable(),
  email: z.string().optional(),
  organization: z.string().optional(),
  subscriptionType: z.string().optional(),
  /** Populated when detection itself failed, as opposed to cleanly not being authed. */
  error: z.string().optional()
})

const codexStatusSchema = z.object({
  authenticated: z.boolean(),
  source: z.enum(['cli', 'api_key']).nullable(),
  error: z.string().optional()
})

const githubStatusSchema = z.object({
  connected: z.boolean(),
  login: z.string().optional(),
  scopes: z.array(z.string()).optional(),
  /** False when MAIN_VITE_GITHUB_CLIENT_ID is missing — the flow can't start. */
  configured: z.boolean(),
  error: z.string().optional()
})

const authStatusSchema = z.object({
  claude: claudeStatusSchema,
  codex: codexStatusSchema,
  github: githubStatusSchema,
  onboardingCompleted: z.boolean(),
  /** False on a Linux box with no keyring; onboarding must say so, not fail silently. */
  secretStorageAvailable: z.boolean()
})

const apiKeyInputSchema = z.object({ apiKey: z.string().min(1) })

/**
 * One in-flight turn, as the UI needs to see it (Phase 6).
 *
 * `contactName` rather than just an id because its whole job is to be shown in
 * a sentence — "Refactor Buddy is already working in this repo" — and the
 * renderer would otherwise have to join back to the contact list to say so.
 */
/** A repo the user could bind to, from the GitHub side (blueprint §9.1). */
const repoOptionSchema = z.object({
  id: z.string(),
  fullName: z.string(),
  cloneUrl: z.string(),
  private: z.boolean(),
  /** Absolute path when already on disk; null means binding it would clone. */
  localPath: z.string().nullable(),
  updatedAt: z.number().nullable()
})

/** Somewhere on disk a Contact can work, however it was arrived at. */
const boundRepoSchema = z.object({
  path: z.string(),
  name: z.string(),
  /** False for a plain directory: allowed, but it can never open a PR. */
  isGitRepo: z.boolean()
})

const activeRunSchema = z.object({
  runId: z.string(),
  contactId: z.string(),
  contactName: z.string(),
  /** What is locked. Equal to the contact's repoPath until worktrees land. */
  workingPath: z.string(),
  /** `shared` runs cannot write, so any number of them may overlap. */
  mode: z.enum(['shared', 'exclusive']),
  startedAt: z.number()
})

export const ipcContract = {
  ping: {
    input: z.void(),
    output: z.object({
      message: z.string(),
      timestamp: z.number()
    })
  },

  // --- Auth (Phase 3, blueprint §15A + §9) --------------------------------
  // Each backend reports independently so the UI renders correctly when one is
  // connected and another isn't.
  'auth.getStatus': {
    input: z.void(),
    output: authStatusSchema
  },
  'auth.setAnthropicApiKey': {
    input: apiKeyInputSchema,
    output: claudeStatusSchema
  },
  'auth.setOpenAiApiKey': {
    input: apiKeyInputSchema,
    output: codexStatusSchema
  },
  'auth.completeOnboarding': {
    input: z.void(),
    output: authStatusSchema
  },

  'codex.startLogin': {
    input: z.void(),
    output: deviceFlowStateSchema
  },
  'codex.getLoginState': {
    input: z.void(),
    output: deviceFlowStateSchema
  },
  'codex.cancelLogin': {
    input: z.void(),
    output: deviceFlowStateSchema
  },

  'github.startDeviceFlow': {
    input: z.void(),
    output: deviceFlowStateSchema
  },
  'github.getDeviceFlowState': {
    input: z.void(),
    output: deviceFlowStateSchema
  },
  'github.cancelDeviceFlow': {
    input: z.void(),
    output: deviceFlowStateSchema
  },
  'github.disconnect': {
    input: z.void(),
    output: githubStatusSchema
  },

  // --- Data layer (Phase 4, blueprint §4 + §12) ---------------------------
  // Entity shapes come from ./domain.ts so main's tables, these procedures,
  // and the renderer's types can't drift apart. Ids are minted in main, hence
  // the `Draft` (id-less) inputs on every create.
  'skills.list': {
    input: z.void(),
    output: z.array(skillSchema)
  },
  'skills.get': {
    input: z.object({ id: z.string() }),
    output: skillSchema.nullable()
  },
  'skills.create': {
    input: skillDraftSchema,
    output: skillSchema
  },
  'skills.update': {
    input: skillSchema,
    output: skillSchema
  },
  'skills.delete': {
    input: z.object({ id: z.string() }),
    output: z.object({ deleted: z.boolean() })
  },

  'personas.list': {
    input: z.void(),
    output: z.array(personaTemplateSchema)
  },
  'personas.get': {
    input: z.object({ id: z.string() }),
    output: personaTemplateSchema.nullable()
  },
  'personas.create': {
    input: personaTemplateDraftSchema,
    output: personaTemplateSchema
  },
  'personas.update': {
    input: personaTemplateSchema,
    output: personaTemplateSchema
  },
  /** Rejects while contacts are bound — the error names them. */
  'personas.delete': {
    input: z.object({ id: z.string() }),
    output: z.object({ deleted: z.boolean() })
  },

  // Read + create only. Sessions, messages, and the UI that calls create are
  // Phase 6; these exist so personas and groups have real relationships now.
  'contacts.list': {
    input: z.void(),
    output: z.array(contactSchema)
  },
  'contacts.get': {
    input: z.object({ id: z.string() }),
    output: contactSchema.nullable()
  },
  'contacts.create': {
    input: contactDraftSchema,
    output: contactSchema
  },

  /** No create: a group is implied by its repo, never made directly (§4). */
  'groups.list': {
    input: z.void(),
    output: z.array(groupSchema)
  },

  // --- Messaging (Phase 6, blueprint §16 Journey 1) -----------------------
  // `send` returns as soon as the turn is running, not when it finishes: the
  // reply arrives on the push channel (src/shared/agent.ts), keyed by the runId
  // returned here. A turn can take minutes, which is far too long to hold an
  // invoke open.
  'messages.list': {
    input: z.object({ contactId: z.string() }),
    output: z.array(messageSchema)
  },
  /** Latest message per contact — ConversationList's preview line. */
  'messages.previews': {
    input: z.void(),
    output: z.array(messageSchema)
  },
  /** Rejects when another persona holds the repo; the error names it. */
  'messages.send': {
    input: z.object({ contactId: z.string(), content: z.string().min(1) }),
    output: z.object({ runId: z.string(), userMessage: messageSchema })
  },
  /** False when the run already finished — a stop that arrives too late. */
  'messages.cancel': {
    input: z.object({ runId: z.string() }),
    output: z.object({ cancelled: z.boolean() })
  },

  /**
   * Everything running right now, across every repo. The renderer needs the
   * whole set rather than its own contact's: a turn on a *sibling* contact is
   * what disables this thread's composer (blueprint §15D).
   */
  'runs.list': {
    input: z.void(),
    output: z.array(activeRunSchema)
  },

  'usage.list': {
    input: z.object({ contactId: z.string().optional() }),
    output: z.array(usageEventSchema)
  },

  /**
   * Hardcoded per backend and dated — neither SDK can be asked what an account
   * may use, so this is a menu rather than a guarantee (see adapters/models.ts).
   */
  'models.listForBackend': {
    input: z.object({ backend: personaBackendSchema }),
    output: z.array(z.string())
  },

  // --- Repo binding (Phase 6, blueprint §9.1) -----------------------------
  // Two routes to the same outcome: a path on disk for a Contact to work in.
  'repos.list': {
    input: z.void(),
    output: z.array(repoOptionSchema)
  },
  /** Native folder picker. Null when the user cancels. */
  'repos.chooseDirectory': {
    input: z.void(),
    output: boundRepoSchema.nullable()
  },
  /** Clones under the workspace root, asking for one if unset. Null on cancel. */
  'repos.clone': {
    input: z.object({ fullName: z.string(), cloneUrl: z.string() }),
    output: boundRepoSchema.nullable()
  },

  /** Opens a verification URL in the user's real browser. Host-allowlisted in main. */
  'shell.openExternal': {
    input: z.object({ url: z.string().url() }),
    output: z.object({ opened: z.boolean() })
  }
} satisfies Record<string, { input: z.ZodType; output: z.ZodType }>

export type IpcContract = typeof ipcContract
export type IpcProcedureName = keyof IpcContract
export type IpcInput<K extends IpcProcedureName> = z.infer<IpcContract[K]['input']>
export type IpcOutput<K extends IpcProcedureName> = z.infer<IpcContract[K]['output']>

export type DeviceFlowState = z.infer<typeof deviceFlowStateSchema>
export type ClaudeAuthStatus = z.infer<typeof claudeStatusSchema>
export type CodexAuthStatus = z.infer<typeof codexStatusSchema>
export type GitHubAuthStatus = z.infer<typeof githubStatusSchema>
export type AuthStatus = z.infer<typeof authStatusSchema>
export type ActiveRun = z.infer<typeof activeRunSchema>
export type RepoOption = z.infer<typeof repoOptionSchema>
export type BoundRepo = z.infer<typeof boundRepoSchema>
