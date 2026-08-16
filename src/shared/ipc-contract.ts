import { z } from 'zod'

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
