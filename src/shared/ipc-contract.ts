import { z } from 'zod'
import {
  auditEventSchema,
  contactDraftSchema,
  contactSchema,
  githubScopeSchema,
  groupMessageSchema,
  groupSchema,
  isolationSchema,
  messageSchema,
  personaBackendSchema,
  personaTemplateDraftSchema,
  personaTemplateSchema,
  repoTrustSchema,
  routineDraftSchema,
  routineSchema,
  routineUpdateSchema,
  skillDraftSchema,
  skillSchema,
  systemSummaryCategorySchema,
  themePreferenceSchema,
  usageEventSchema,
  contactUsageSummarySchema
} from './domain'

/**
 * Single source of truth for main<->renderer IPC. Every procedure has an
 * input/output Zod schema, validated on both sides of the boundary by
 * registerProcedure() (main) and callProcedure() (renderer).
 *
 * Hand-rolled rather than electron-trpc, which was checked against this
 * toolchain and found stale and incompatible with it.
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
  /**
   * A token is stored. Says nothing about whether it still works — that is
   * `tokenState`, and conflating the two is what let a revoked token show a
   * connected dot indefinitely.
   */
  connected: z.boolean(),
  login: z.string().optional(),
  scopes: z.array(z.string()).optional(),
  /** False when MAIN_VITE_GITHUB_CLIENT_ID is missing — the flow can't start. */
  configured: z.boolean(),
  /**
   * What GitHub last said about the stored token. Absent when none is stored.
   *
   * A field rather than something inferred from `error`'s wording: the renderer
   * has to treat "rejected" and "unreachable" differently — one wants Reconnect
   * and one wants to be left alone — and deciding that by regex on prose is the
   * failure this whole change is fixing one layer down.
   */
  tokenState: z.enum(['unverified', 'good', 'rejected', 'unreachable', 'locked']).optional(),
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
 * A repo the user could bind to, from the GitHub side — listed through the API
 * rather than typed as a path, and offered for cloning when it is not on disk.
 */
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

/**
 * What a turn on a Contact would inject, broken into its parts.
 *
 * Every size is a **character count**. See `contacts.context` below for why
 * there are no token figures here: the only honest ones live in usage_events,
 * because they were measured by the backend rather than guessed at by us.
 */
const contactContextSchema = z.object({
  persona: z.object({
    id: z.string(),
    name: z.string(),
    backend: personaBackendSchema,
    model: z.string().nullable()
  }),
  /** The resume key. Null until the first turn has run. */
  sessionId: z.string().nullable(),
  systemPromptChars: z.number(),
  /** In the order composeInstructions writes them, which is persona.skillIds. */
  skills: z.array(z.object({ id: z.string(), name: z.string(), chars: z.number() })),
  /**
   * What the *repository* contributes, which is a different thing from `skills`
   * above and shares a word with it (see CLAUDE.md).
   *
   * `repoSkills` are `SKILL.md` documents the backend discovers by itself;
   * `injectedSkills` are the ones it cannot, described to the model instead.
   * `repoInstructions` is the repo's own CLAUDE.md/AGENTS.md. All three are
   * empty until a human has opted this Contact in, and that is the normal case
   * — the panel has to be able to say "nothing" and mean it.
   */
  repoSkills: z.array(z.string()),
  injectedSkills: z.array(z.object({ name: z.string(), description: z.string() })),
  repoInstructions: z.object({ fileName: z.string(), chars: z.number() }).nullable(),
  /**
   * What this contact currently trusts its repository to say — the *decision*,
   * where the three fields above are its consequences.
   *
   * Carried here so the panel that reports what a turn receives is also the
   * place the grant is made. Keeping them on separate screens would mean
   * reading the effect in one place and changing the cause in another.
   */
  repoTrust: repoTrustSchema,
  /** Reachable servers, already narrowed by the persona's githubScope. */
  mcpServers: z.array(z.object({ id: z.string(), url: z.string(), deniedTools: z.number() })),
  /**
   * Granted to the persona and not reachable this turn, with the reason.
   *
   * Distinct from an empty `mcpServers` on purpose: "nothing configured" and
   * "configured, but GitHub is not connected" are different states, and a panel
   * that renders both as silence is the reason a persona can report finding no
   * issues when it never looked. The session is told the same thing — see
   * SessionSpec.unavailableServers.
   */
  unavailableServers: z.array(z.object({ id: z.string(), reason: z.string() })),
  /** The filtered, capped repo log — not everything groupMessages.list returns. */
  groupContext: z.array(
    z.object({
      timestamp: z.number(),
      category: systemSummaryCategorySchema.optional(),
      durable: z.boolean().optional(),
      chars: z.number()
    })
  ),
  siblingBranches: z.array(z.object({ branch: z.string(), contactName: z.string() })),
  workingContext: z
    .object({ workingPath: z.string(), repoPath: z.string(), branch: z.string() })
    .nullable(),
  /** The literal string both adapters receive. */
  instructions: z.string(),
  instructionsChars: z.number()
})

export type ContactContext = z.infer<typeof contactContextSchema>
export type RepoOffers = NonNullable<IpcOutput<'contacts.repoOffers'>>

/**
 * One in-flight turn, as the UI needs to see it.
 *
 * `contactName` rather than just an id because its whole job is to be shown in
 * a sentence — "Refactor Buddy is already working in this repo" — and the
 * renderer would otherwise have to join back to the contact list to say so.
 */
const activeRunSchema = z.object({
  runId: z.string(),
  contactId: z.string(),
  contactName: z.string(),
  /** What is locked: the contact's worktree if it has one, else its repo. */
  workingPath: z.string(),
  /** `shared` runs cannot write, so any number of them may overlap. */
  mode: z.enum(['shared', 'exclusive']),
  startedAt: z.number(),
  /**
   * What started the turn. Flattened rather than a nested union so a renderer
   * surface filters with a field compare — and so output validation fails
   * loudly if main forgets to populate it. Before this existed, no surface
   * could tell a routine fire from a chat, which is why the Routines pane
   * couldn't say "running" about its own routine.
   */
  origin: z.enum(['message', 'mention', 'routine']),
  /** Set when origin is `routine`. */
  routineId: z.string().nullable(),
  /** Set when origin is `mention` — the group thread it was sent from. */
  groupId: z.string().nullable(),
  /**
   * The write an `ask_writes` turn is paused on, or null. Rides on the run row
   * so the approval card needs no channel of its own: pending asks emit
   * `runs-changed`, and this list is what that push refetches.
   */
  approval: z
    .object({
      id: z.string(),
      toolName: z.string(),
      detail: z.string(),
      requestedAt: z.number()
    })
    .nullable()
})

/**
 * A branch that exists in the repo but is checked out nowhere the user can see.
 *
 * Sourced from git rather than from the contacts table: a branch outlives the
 * Contact that made it, so `contactId` and `contactName` are null for the ones
 * whose owner has been deleted — which are exactly the ones most at risk of
 * being forgotten.
 */
export const branchSummarySchema = z.object({
  repoPath: z.string(),
  branch: z.string(),
  headSha: z.string(),
  committedAt: z.number(),
  contactId: z.string().nullable(),
  contactName: z.string().nullable(),
  files: z.array(z.string()),
  hasWorktree: z.boolean(),
  /** Whether the main tree's HEAD already contains this branch. */
  merged: z.boolean(),
  /** Uncommitted paths in the branch's live worktree; what commit would land. */
  dirtyFiles: z.array(z.string()),
  /**
   * The GitHub authority of the persona behind this branch, so the panel knows
   * whether to offer a pull request. Null when the Contact is gone — an orphan
   * branch has no persona to authorise anything, and can only be merged or
   * discarded.
   */
  githubScope: githubScopeSchema.nullable()
})

/**
 * One file of a diff. Content is served whole under stated budgets — an
 * over-budget side is withheld with `truncated: true`, never clipped, so half a
 * file can never review as a whole one. `live` marks a pair whose new side was
 * read off the working tree just now rather than from the turn's own moment.
 */
export const fileDiffSchema = z.object({
  path: z.string(),
  oldPath: z.string().optional(),
  status: z.enum(['added', 'modified', 'deleted', 'renamed']),
  binary: z.boolean(),
  truncated: z.boolean(),
  live: z.boolean(),
  oldText: z.string().nullable(),
  newText: z.string().nullable()
})

/** An open pull request, as GitHub reports it. Never stored — see pull-requests.ts. */
export const prRefSchema = z.object({
  number: z.number(),
  url: z.string(),
  title: z.string()
})

export const prStateSchema = z.object({
  /** Whether this Contact has a pull-request path at all. False hides the action. */
  available: z.boolean(),
  pr: prRefSchema.nullable()
})

export const prResultSchema = prRefSchema.extend({
  /** `commented` when the branch already had a pull request open. */
  action: z.enum(['created', 'commented'])
})

export const mergeTargetSchema = z.object({
  path: z.string(),
  label: z.string(),
  dirty: z.boolean()
})

export type BranchSummary = z.infer<typeof branchSummarySchema>
export type MergeTarget = z.infer<typeof mergeTargetSchema>
export type PrRef = z.infer<typeof prRefSchema>
export type PrState = z.infer<typeof prStateSchema>
export type PrResult = z.infer<typeof prResultSchema>

/**
 * See personas.create/update below. Shared so the two write paths cannot
 * drift; the same rule is checked again in persona-templates.ts, because a
 * Zod boundary someone routes around is a lock on a door with two doorways.
 */
function requireScopePairing(
  persona: { backend: string; sandbox: string; githubScope: string },
  ctx: z.RefinementCtx
): void {
  if (persona.sandbox === 'full_access' && persona.githubScope !== 'full_access') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['githubScope'],
      message:
        'A persona with full sandbox access cannot carry a narrower GitHub scope — full access bypasses the tools that would enforce it.'
    })
  }
  // The ask posture needs a backend that can hold a turn open while
  // a human answers, and Codex's exec channel cannot (see
  // askBeforeWritesSupported). Checked again in persona-templates.ts, for the
  // same two-doorways reason as the rule above.
  if (persona.sandbox === 'ask_writes' && persona.backend !== 'claude') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['sandbox'],
      message:
        'Ask-before-writes needs a backend that can pause mid-turn for an answer, and Codex cannot — its exec channel has no way to deliver one.'
    })
  }
}

export const ipcContract = {
  ping: {
    input: z.void(),
    output: z.object({
      message: z.string(),
      timestamp: z.number()
    })
  },

  // --- Auth ---------------------------------------------------------------
  // App-level backend logins (Claude, Codex) plus GitHub's, which is a separate
  // credential answering a separate question. Each backend reports
  // independently so the UI renders correctly when one is connected and another
  // isn't.
  'auth.getStatus': {
    input: z.void(),
    output: authStatusSchema
  },
  /**
   * `auth.getStatus` with both backend probes forced. Separate procedure rather
   * than a flag on getStatus so the cheap cached read stays the default and a
   * forced double-probe (a Claude subprocess plus a Codex CLI spawn) is always
   * a deliberate act: the Retry affordance on an auth card, or a window-focus
   * recovery after a probe reported that it failed to check.
   */
  'auth.refresh': {
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
  /**
   * Key removal, from the settings surface. Each returns the fresh per-backend
   * status so the renderer can patch its cache slice without re-paying for the
   * other probes. Neither is a sign-out of a CLI login:
   * Claude Code's browser auth is not ours to revoke, and clearing the OpenAI
   * key signs the codex CLI out only when the key was how it signed in.
   */
  'auth.clearAnthropicKey': {
    input: z.void(),
    output: claudeStatusSchema
  },
  'auth.clearOpenAiKey': {
    input: z.void(),
    output: codexStatusSchema
  },

  /** Where clones land — set implicitly on first clone, surfaced in settings. */
  'workspace.getRoot': {
    input: z.void(),
    output: z.object({
      path: z.string().nullable(),
      /** False when the remembered directory is gone or unmounted. */
      exists: z.boolean()
    })
  },
  /** Native directory picker; persists the choice. Null when cancelled. */
  'workspace.chooseRoot': {
    input: z.void(),
    output: z.object({ path: z.string().nullable() })
  },

  'appInfo.get': {
    input: z.void(),
    output: z.object({
      version: z.string(),
      platform: z.string(),
      /** True in `npm run dev` — gates the Settings Developer section. */
      dev: z.boolean()
    })
  },

  /**
   * The theme the user picked. Stored app-side rather than in the renderer
   * because main paints the window background from it before the bundle loads
   * (see services/theme.ts).
   */
  'theme.get': {
    input: z.void(),
    output: z.object({ preference: themePreferenceSchema })
  },
  'theme.set': {
    input: z.object({ preference: themePreferenceSchema }),
    output: z.object({ preference: themePreferenceSchema })
  },

  /** OS notifications on/off. Default ON — absence of the flag means enabled. */
  'notifications.get': {
    input: z.void(),
    output: z.object({ enabled: z.boolean() })
  },
  'notifications.set': {
    input: z.object({ enabled: z.boolean() }),
    output: z.object({ enabled: z.boolean() })
  },

  /**
   * The app-level soft monthly spend threshold. Null = no budget.
   * Alerts only — crossing it notifies and banners, nothing is stopped.
   * Per-routine thresholds live on the routine rows, not here.
   */
  'budget.get': {
    input: z.void(),
    output: z.object({ monthlyBudgetUsd: z.number().nullable() })
  },
  'budget.set': {
    input: z.object({ monthlyBudgetUsd: z.number().positive().nullable() }),
    output: z.object({ monthlyBudgetUsd: z.number().nullable() })
  },

  /**
   * Wipes the app back to a fresh install and relaunches. Dev tooling only, and
   * gated on `appInfo.dev`: profile, secrets, worktrees and persona branches all
   * go; the user's backend logins and cloned repositories are never touched. The
   * response races the relaunch and may never arrive — callers must not wait
   * on it for UI state.
   */
  'dev.resetApp': {
    input: z.void(),
    output: z.object({ ok: z.boolean() })
  },

  /**
   * The starter catalog: everything the app *can* seed, flagged recommended
   * (the tier startup installs by itself) and installed (a row with that id
   * exists right now). Feeds the onboarding picker and the starter library
   * dialog.
   */
  'seed.catalog': {
    input: z.void(),
    output: z.object({
      personas: z.array(
        z.object({
          entry: personaTemplateSchema,
          recommended: z.boolean(),
          installed: z.boolean()
        })
      ),
      skills: z.array(
        z.object({ entry: skillSchema, recommended: z.boolean(), installed: z.boolean() })
      )
    })
  },
  /**
   * Aligns installed starter content with a selection. Catalog ids only —
   * user-created rows are untouchable through this, unknown ids are an error,
   * and removal is refused where it would strand a contact or strip an
   * attached skill (see services/seed.ts).
   */
  'seed.applySelection': {
    input: z.object({ personaIds: z.array(z.string()), skillIds: z.array(z.string()) }),
    output: z.object({ personas: z.number(), skills: z.number() })
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
  /**
   * Asks GitHub whether the stored token still works, and returns the status
   * that answer produced.
   *
   * Separate from `auth.getStatus` because that one is synchronous and must
   * stay so — it is called on every render path in the shell. This one makes a
   * network request, so the renderer chooses when to pay for it: at launch, and
   * when the window regains focus.
   */
  'github.verify': {
    input: z.void(),
    output: githubStatusSchema
  },

  // --- Remote actions -------------------------------------------------------
  // Pushes and pull requests go through GitHub's REST API from main, never by
  // trusting an agent to shell out git commands unsupervised, and always as an
  // explicit user action rather than an automatic side effect of a turn — which
  // matters most for the turns nobody is watching, i.e. routine fires.
  //
  // Keyed by Contact rather than by branch, because the permission being
  // checked belongs to a persona: an orphan branch has nobody to authorise it.

  /** Whether to offer the action, and the pull request it already has. Read-only. */
  'github.pullRequestState': {
    input: z.object({ contactId: z.string() }),
    output: prStateSchema
  },
  /**
   * Pushes the Contact's branch and opens a pull request — or comments on the
   * one already open. Refuses a `read_only` persona here, not only in the UI.
   */
  'github.openPullRequest': {
    input: z.object({ contactId: z.string() }),
    output: prResultSchema
  },

  // --- Data layer ---------------------------------------------------------
  // Entity shapes come from./domain.ts so main's tables, these procedures,
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
  /**
   * Both write shapes refuse full_access sandbox + narrower githubScope: under
   * `bypassPermissions` (Claude) / `danger-full-access` (Codex) neither backend
   * asks this app anything again, so neither the MCP tool filter nor the shell
   * guard runs and a narrower scope there is a promise nothing can keep. The
   * combination is made unrepresentable rather than validated after the fact.
   * Inputs only — the shared output schema stays permissive so rows predating
   * migration 0010 still read.
   */
  'personas.create': {
    input: personaTemplateDraftSchema.superRefine(requireScopePairing),
    output: personaTemplateSchema
  },
  'personas.update': {
    input: personaTemplateSchema.superRefine(requireScopePairing),
    output: personaTemplateSchema
  },
  /** Rejects while contacts are bound — the error names them. */
  'personas.delete': {
    input: z.object({ id: z.string() }),
    output: z.object({ deleted: z.boolean() })
  },

  // --- Routines -------------------------------------------------------------
  // Scheduled wake tasks, run by node-cron in main through the same
  // AgentAdapter.run() a chat message uses — no vendor-side scheduling.
  //
  // `lastRunAt`/`lastRunSummary` are absent from both write shapes: run history
  // is the scheduler's to write, and taking a whole routine on update would let
  // an editor open across a fire save its stale copy back over the run.
  'routines.list': {
    input: z.void(),
    output: z.array(routineSchema)
  },
  'routines.get': {
    input: z.object({ id: z.string() }),
    output: routineSchema.nullable()
  },
  /** Rejects a schedule the scheduler could not arm — main validates too. */
  'routines.create': {
    input: routineDraftSchema,
    output: routineSchema
  },
  'routines.update': {
    input: routineUpdateSchema,
    output: routineSchema
  },
  'routines.delete': {
    input: z.object({ id: z.string() }),
    output: z.object({ deleted: z.boolean() })
  },
  /**
   * Cron validation, in main because node-cron lives there.
   *
   * The renderer could not do this without shipping a scheduler runtime into
   * its own bundle, and a second hand-rolled validator is the drift this repo
   * has been bitten by twice. `nextRuns` feeds the editor's "Next:..." hint,
   * which is more use than restating the expression back at the user.
   */
  'routines.validateSchedule': {
    input: z.object({ schedule: z.string() }),
    output: z.object({
      valid: z.boolean(),
      error: z.string().nullable(),
      nextRuns: z.array(z.number())
    })
  },
  /**
   * The manual trigger behind "Run now".
   *
   * Returns as soon as the turn is *running*, exactly like `messages.send`, so
   * the reply streams on the push channel rather than holding an invoke open
   * for what can be minutes. `runId` is null when the turn never started —
   * refused by the run lock, or the routine is gone — and `skipped` says why.
   *
   * This is the same `fireRoutine` a cron tick calls, with no branch between
   * them — which is what makes clicking the button a truthful demonstration of
   * what the schedule does at 3 a.m., rather than a second code path that
   * merely looks like it.
   */
  'routines.runNow': {
    input: z.object({ id: z.string() }),
    output: z.object({
      runId: z.string().nullable(),
      skipped: z.string().nullable(),
      /**
       * The contact the routine runs as, when the turn started. Returned so
       * the renderer can enter the run store immediately (live bubble, busy
       * composer) instead of waiting for a push round-trip. Null on skip.
       */
      contactId: z.string().nullable()
    })
  },

  /**
   * The scheduler's next-fire view, joined to contact names — the same data
   * the tray menu draws, exposed so Home can answer "what happens next"
   * without the user opening the Routines section.
   */
  'routines.nextRuns': {
    input: z.void(),
    output: z.array(
      z.object({
        routineId: z.string(),
        prompt: z.string(),
        contactName: z.string().nullable(),
        /** Epoch ms, or null when the engine cannot say. */
        nextRun: z.number().nullable()
      })
    )
  },

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
  /**
   * Renames a Contact, and does nothing else on purpose.
   *
   * The input is `{ id, displayName }` rather than a partial Contact because
   * the other columns are load-bearing: repoPath is the Group key and the
   * run-lock key, worktreePath and branch are pointed at by a real checkout on
   * disk, and personaTemplateId decides which SDK owns backendSessionId. A
   * permissive update shape here would be a way to silently orphan a live
   * worktree and a live session; the narrow input makes that unavailable at the
   * Zod boundary instead of relying on a service-level check.
   *
   * A Contact bound to the wrong repo is deleted and made again — which is what
   * `contacts.delete`'s worktree cleanup below is for. The persona binding alone
   * has a dedicated, safe path: `rebindPersona` below.
   */
  'contacts.update': {
    input: z.object({ id: z.string(), displayName: z.string().min(1) }),
    output: contactSchema
  },
  /**
   * Moves a Contact to another persona — the one binding change that CAN be
   * made safe, so it is: the resume key is cleared in the same transaction (a
   * session id is an index into one SDK's storage, and the new persona may be
   * on the other backend), while the repo, worktree, branch and message history
   * all stay. Refused while a turn is running — rebinding under a live stream
   * would change who is speaking mid-sentence.
   *
   * repoPath remains immutable; its remedy is delete-and-recreate, guided by
   * the prefilled NewContactFlow. Isolation is mutable by its own procedure —
   * see `contacts.setIsolation`.
   */
  'contacts.rebindPersona': {
    input: z.object({ id: z.string(), personaTemplateId: z.string() }),
    output: contactSchema
  },
  /**
   * Drops the resume key on purpose, so the next turn starts the backend over
   * while the conversation on screen stays exactly as it is.
   *
   * Its own procedure rather than a flag on anything above, because it is the
   * one act whose entire point is what it does *not* change. Every turn is
   * billed for the whole conversation the session can see, so this is the only
   * direct lever over session cost — it exists in its own right rather than as
   * a side effect of `rebindPersona`, which also clears the key but changes who
   * is answering.
   */
  'contacts.startFreshSession': {
    input: z.object({ id: z.string() }),
    output: contactSchema
  },
  /**
   * Replaces a Contact and brings its conversation with it.
   *
   * One procedure rather than a renderer-side create-then-delete pair, because
   * the two halves are one decision: the old contact's rows are re-pointed at
   * the new one in between, and a failure partway through a client-driven
   * sequence leaves either two contacts or a deleted thread.
   *
   * `bringHistory: false` lets the old thread go with the old contact, which is
   * to say it is deleted — a genuinely fresh start is a reasonable thing to want
   * and should not require deleting twice.
   */
  'contacts.recreate': {
    input: z.object({
      fromId: z.string(),
      draft: contactDraftSchema,
      bringHistory: z.boolean(),
      discardUncommitted: z.boolean().optional()
    }),
    output: contactSchema
  },
  /**
   * A model for this Contact alone, or null to follow its persona again.
   *
   * Nullable rather than optional: "go back to the persona's" is a choice the
   * user makes, not an absent value, and an optional field could not express
   * it.
   */
  'contacts.setModel': {
    input: z.object({ id: z.string(), model: z.string().nullable() }),
    output: contactSchema
  },
  /**
   * Moves a Contact between the repo itself and its own checkout.
   *
   * Its own procedure rather than a widened `contacts.update`, for the reason
   * `setRepoTrust` gives below: a rename and a relocation are different
   * decisions, and one permissive update is how the second becomes a side
   * effect of the first.
   *
   * `discardUncommitted` only matters when leaving a worktree that has
   * uncommitted changes — main refuses without it, and that refusal is a
   * decision to put in front of a human rather than an error to render red.
   * The same two-step `contacts.delete` uses.
   */
  'contacts.setIsolation': {
    input: z.object({
      id: z.string(),
      isolation: isolationSchema,
      discardUncommitted: z.boolean().optional()
    }),
    output: contactSchema
  },
  /**
   * What this contact lets its repository say to it — a governance decision,
   * not a preference: a repo's CLAUDE.md, AGENTS.md and skills are instructions
   * written by whoever owns it, and a persona reaches none of them by default.
   *
   * Separate from `contacts.update` on purpose. A rename and a grant of trust
   * are different decisions with different consequences, and one permissive
   * contact update would make it possible to turn a repository's instructions
   * on as a side effect of renaming a contact.
   *
   * `skills` is an allowlist of names, not a boolean: a human approves what was
   * in the repository when they looked, and a skill committed afterwards has
   * been approved by nobody. capabilitiesFor() intersects these names with what
   * is actually on disk at the time of the turn.
   */
  'contacts.setRepoTrust': {
    input: z.object({ id: z.string(), trust: repoTrustSchema }),
    output: contactSchema
  },
  /**
   * What this contact's repository is *offering* — every `SKILL.md` on disk and
   * whether it ships instructions, approved or not.
   *
   * Distinct from `contacts.context`, which reports what a turn would actually
   * send. This is the other half of the same screen: you cannot approve a skill
   * that nothing has told you exists, and the panel would otherwise show an
   * empty list whether the repository ships nothing or ships ten things nobody
   * has looked at yet.
   *
   * Read fresh from disk rather than cached, so a skill added to the repository
   * since the app started is offerable without a restart.
   */
  'contacts.repoOffers': {
    input: z.object({ contactId: z.string() }),
    output: z
      .object({
        instructionsFile: z.string().nullable(),
        skills: z.array(
          z.object({
            name: z.string(),
            description: z.string(),
            /** Which convention it came from, e.g. `.claude/skills`. */
            root: z.string(),
            /**
             * Whether the backend would discover this itself once approved, or
             * whether the app has to describe it. Codex-only, and false for
             * every skill on Claude — see capabilitiesFor().
             */
            codexNative: z.boolean()
          })
        )
      })
      .nullable()
  },
  /**
   * What the *next* turn on this contact would inject: its system prompt and
   * resolved skills, plus the repo's durable and recent group log.
   *
   * A snapshot of what would be sent now, not a record of what was sent last
   * turn: the session spec is resolved per turn, so this moves as colleagues
   * write summaries and open branches.
   *
   * Resolved in main because the renderer cannot see any of it — contextForRepo
   * filters and caps the group log in ways `groupMessages.list` does not,
   * siblingBranchesFor stats `.git` on disk, and the headings that wrap the
   * whole thing are constants in adapters/context.ts. `instructions` is the
   * literal string both adapters receive, which is the one thing worth showing
   * and the one thing a renderer-side copy could never be trusted to reproduce.
   *
   * Sizes are **characters, not tokens**. Nothing in this process can tokenize
   * for either backend, and a chars/4 guess printed beside a measured token
   * count from usage_events would read as equally authoritative.
   */
  'contacts.context': {
    input: z.object({ contactId: z.string() }),
    output: contactContextSchema.nullable()
  },
  /**
   * Delete exists because a Contact now owns something outside the database —
   * its worktree — and nothing else can clean that up.
   *
   * `discardUncommitted` defaults to false, so the first attempt refuses when
   * the worktree has unsaved changes and the caller has to decide. Committed
   * work is never at risk: the branch survives, and the Branches panel is where
   * it gets dealt with.
   */
  'contacts.delete': {
    input: z.object({ id: z.string(), discardUncommitted: z.boolean().optional() }),
    output: z.object({ deleted: z.boolean() })
  },

  /**
   * Per-conversation unread counts, both kinds in one call. The
   * renderer refetches on messages-changed, so this is the single authority
   * the sidebar badges, thread dividers, and dock badge all agree with.
   */
  'unread.counts': {
    input: z.void(),
    output: z.array(
      z.object({
        kind: z.enum(['contact', 'group']),
        id: z.string(),
        count: z.number()
      })
    )
  },
  /**
   * Stamps the unread boundary. Narrow single-purpose writers on the
   * setRepoTrust pattern; monotonic in the service, so a stale caller cannot
   * un-read anything.
   */
  'contacts.markRead': {
    input: z.object({ id: z.string() }),
    output: contactSchema
  },
  /**
   * The contact's working tree for @file autocomplete: tracked plus
   * untracked-but-not-ignored, relative paths in git's order. Falls back to
   * the bound repo while an isolated contact's worktree doesn't exist yet,
   * and degrades to [] for a non-repo binding. Capped; `truncated` says so.
   */
  'contacts.files': {
    input: z.object({ contactId: z.string() }),
    output: z.object({ files: z.array(z.string()), truncated: z.boolean() })
  },
  'groups.markRead': {
    input: z.object({ id: z.string() }),
    output: groupSchema
  },

  /**
   * Rename a group, or clear the override with null and fall back to the
   * repository's own name.
   *
   * `.trim().min(1)` matches `contacts.update`: a name of spaces is refused
   * here rather than stored and rendered as a blank row. Null is explicit and
   * distinct from the empty string precisely so that "put it back" is something
   * the contract can express without a second procedure.
   */
  'groups.rename': {
    input: z.object({ id: z.string(), name: z.string().trim().min(1).nullable() }),
    output: groupSchema
  },

  /**
   * Keep a group out of the conversation list, or bring it back.
   *
   * Its own procedure rather than a widened update, following
   * `contacts.setRepoTrust`: one narrow procedure per state change, so the Zod
   * boundary keeps saying that renaming a group and removing it from view are
   * different decisions.
   */
  'groups.setHidden': {
    input: z.object({ id: z.string(), hidden: z.boolean() }),
    output: groupSchema
  },

  /** No create: a group is implied by its repo, never made directly. */
  'groups.list': {
    input: z.void(),
    output: z.array(groupSchema)
  },
  /** Null when nothing is bound to that repo yet, so it has no group. */
  'groups.getForRepo': {
    input: z.object({ repoPath: z.string() }),
    output: groupSchema.nullable()
  },

  // --- Group coordination -------------------------------------------------
  // The layer that carries intent between Contacts bound to one repo. Code
  // changes cross for free — every session reads the same disk — while the
  // reasoning behind them lives in a private thread, so it is written to the
  // group as a summary and re-injected into every later session on that repo.
  'groupMessages.list': {
    input: z.object({ groupId: z.string() }),
    output: z.array(groupMessageSchema)
  },
  /** Latest message per group — ConversationList's preview line. */
  'groupMessages.previews': {
    input: z.void(),
    output: z.array(groupMessageSchema)
  },
  /**
   * Routes a Group @mention to one Contact's real session.
   *
   * Deliberately the same shape as `messages.send`, because it *is* that call
   * with two extra rows: the reply streams back on the same push channel under
   * the returned runId, and lands in the Contact's 1:1 thread as well as the
   * Group. Single-target only — broadcast is deliberately not built.
   *
   * Rejects when the mentioned Contact cannot take the lock, exactly as
   * `messages.send` does, and writes nothing when it does: a persisted mention
   * that never gets an answer reads as a lost message rather than a refusal.
   */
  'groups.mention': {
    input: z.object({
      groupId: z.string(),
      contactId: z.string(),
      content: z.string().min(1)
    }),
    output: z.object({ runId: z.string(), groupMessage: groupMessageSchema })
  },

  // --- Messaging ----------------------------------------------------------
  // `send` returns as soon as the turn is running, not when it finishes: the
  // reply arrives on the push channel (src/shared/agent.ts), keyed by the runId
  // returned here. A turn can take minutes, which is far too long to hold an
  // invoke open.
  /**
   * Per-file content for one turn's work: the committed half between the turn's
   * own heads, and the newly-dirty half read live.
   */
  'messages.workDiff': {
    input: z.object({ contactId: z.string(), messageId: z.string() }),
    output: z.object({ files: z.array(fileDiffSchema), filesOmitted: z.number() })
  },
  /**
   * The persisted tool record for a thread: which tools each turn ran, how each
   * ended, and the bounded detail/output excerpts the live stream showed —
   * capped where they are written, in messaging.ts. Persisted rather than left
   * live because the run nobody watches is a routine firing at 3 a.m., and the
   * morning after there would otherwise be a record of what the persona
   * concluded and none of what it called. messageId is null for calls whose
   * turn died before its reply was written; the renderer shows those as
   * interrupted.
   */
  'messages.toolCalls': {
    input: z.object({ contactId: z.string() }),
    output: z.array(
      z.object({
        id: z.string(),
        messageId: z.string().nullable(),
        name: z.string(),
        status: z.enum(['running', 'completed', 'failed']),
        createdAt: z.number(),
        detail: z.string().optional(),
        output: z.string().optional()
      })
    )
  },
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
   * Re-runs the thread's last user message without writing a second row — the
   * failed turn already persisted it. Throws 'Nothing to retry.' when the tail
   * is an assistant reply, and rejects on a lock refusal exactly like
   * messages.send. `groupId` routes the reply to that group (a retry clicked
   * in the group thread); absent, the reply stays in the 1:1 thread.
   */
  'messages.retry': {
    input: z.object({ contactId: z.string(), groupId: z.string().optional() }),
    output: z.object({ runId: z.string() })
  },

  /**
   * Full-text search over message content, both 1:1 and group (FTS5,
   * migration 0017). Snippets decorate matched tokens with the \u0001/\u0002
   * control characters for the renderer to highlight — printable markers
   * would collide with code in the text. Under two characters returns []
   * rather than matching the world; raw FTS5 syntax in the query is quoted
   * away by the service, never an error.
   */
  'search.messages': {
    input: z.object({ query: z.string(), limit: z.number().int().positive().optional() }),
    output: z.array(
      z.discriminatedUnion('kind', [
        z.object({
          kind: z.literal('message'),
          contactId: z.string(),
          messageId: z.string(),
          snippet: z.string(),
          timestamp: z.number()
        }),
        z.object({
          kind: z.literal('group_message'),
          groupId: z.string(),
          groupMessageId: z.string(),
          snippet: z.string(),
          timestamp: z.number()
        })
      ])
    )
  },

  /**
   * Everything running right now, across every repo. The renderer needs the
   * whole set rather than its own contact's: a turn on a *sibling* contact is
   * what disables this thread's composer.
   */
  'runs.list': {
    input: z.void(),
    output: z.array(activeRunSchema)
  },
  /**
   * Answers a pending ask. `resolved: false` is a stale click —
   * the ask already timed out, was answered elsewhere, or its turn ended —
   * which the card absorbs by refetching rather than surfacing an error the
   * user cannot act on.
   */
  'runs.resolveApproval': {
    input: z.object({ runId: z.string(), approvalId: z.string(), approved: z.boolean() }),
    output: z.object({ resolved: z.boolean() })
  },

  'usage.list': {
    input: z.object({ contactId: z.string().optional() }),
    output: z.array(usageEventSchema)
  },

  /**
   * Repo/contact governance history. Filter params are accepted
   * here as an on-ramp for real server-side filtering later — audit_events
   * is indexed on both — but this pass returns the whole table and leaves
   * filtering/grouping client-side, matching usage.list's own posture today.
   */
  'audit.list': {
    input: z
      .object({ contactId: z.string().optional(), repoPath: z.string().optional() })
      .optional(),
    output: z.array(auditEventSchema)
  },

  /**
   * What each Contact has spent, rolled up in SQL.
   *
   * Distinct from `usage.list` rather than replacing it, because the two answer
   * different questions and only one of them scales. A rail wants one figure per
   * conversation; the dashboard charts per-day buckets and genuinely needs the
   * rows. Handing the rail the rows meant it loaded the entire table to compute
   * a number per contact, which is the cost this exists to remove.
   *
   * No input: the rail draws every row it has, so narrowing here would only mean
   * a second query key for the same answer. Contacts with no spend are simply
   * absent — a missing entry is "has not run a turn", which the rail renders as
   * no badge at all rather than as `$0.00`, and that distinction is the same one
   * `formatCostSummary` protects.
   */
  'usage.summaries': {
    input: z.void(),
    output: z.array(contactUsageSummarySchema)
  },

  /**
   * Hardcoded per backend and dated — neither SDK can be asked what an account
   * may use, so this is a menu rather than a guarantee (see adapters/models.ts).
   */
  'models.listForBackend': {
    input: z.object({ backend: personaBackendSchema }),
    output: z.array(z.string())
  },

  // --- Repo binding -------------------------------------------------------
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

  // --- Branches -----------------------------------------------------------
  // Worktree isolation gives each writing Contact its own checkout and its own
  // branch automatically; this is the part with a human in it, where one
  // checkout's work lands somewhere else. Nothing here merges, commits or
  // discards without an explicit call.

  'branches.list': {
    input: z.void(),
    output: z.array(branchSummarySchema)
  },
  /** Every working copy the branch could be merged into, and whether it is clean. */
  'branches.targets': {
    input: z.object({ repoPath: z.string() }),
    output: z.array(mergeTargetSchema)
  },
  /**
   * A true dry run — `git merge-tree` merges in the object store, so no working
   * copy is touched and nothing needs aborting afterwards.
   */
  'branches.preview': {
    input: z.object({ repoPath: z.string(), targetPath: z.string(), branch: z.string() }),
    output: z.object({ clean: z.boolean(), conflicts: z.array(z.string()) })
  },
  'branches.merge': {
    // repoPath rides along so the merge can stamp the branch_request it
    // answers — the target path alone does not say which repo's group asked.
    input: z.object({ repoPath: z.string(), targetPath: z.string(), branch: z.string() }),
    output: z.object({ merged: z.boolean() })
  },
  /**
   * Per-file content for a branch's diff: merge-base → tip, renames detected,
   * binaries flagged, budgets stated on fileDiffSchema.
   */
  'branches.diff': {
    input: z.object({ repoPath: z.string(), branch: z.string() }),
    output: z.object({
      baseSha: z.string().nullable(),
      files: z.array(fileDiffSchema),
      filesOmitted: z.number()
    })
  },
  /**
   * Lands a branch's uncommitted work as a commit — the one way this app ever
   * authors one, and it is a human click. Author is the persona; committer is
   * the user's own git identity.
   */
  'branches.commit': {
    input: z.object({ repoPath: z.string(), branch: z.string(), message: z.string().min(1) }),
    output: z.object({ committedSha: z.string(), files: z.array(z.string()) })
  },
  /** Refuses unmerged work unless `force`, which the confirm dialog supplies. */
  'branches.discard': {
    input: z.object({ repoPath: z.string(), branch: z.string(), force: z.boolean().optional() }),
    output: z.object({ deleted: z.boolean() })
  },

  /** Opens a verification URL in the user's real browser. Host-allowlisted in main. */
  'shell.openExternal': {
    input: z.object({ url: z.string().url() }),
    output: z.object({ opened: z.boolean() })
  },

  // --- Local paths --------------------------------------------------------
  // Both validated in main against the roots the app actually knows — bound
  // repos and its own worktrees — so this never becomes a general "open
  // whatever the renderer says" primitive, the same rule openExternal set.
  /** Opens a folder (Finder/Explorer) or a file in its default app. */
  'shell.openPath': {
    input: z.object({ path: z.string() }),
    output: z.object({ opened: z.boolean() })
  },
  /** Reveals a file or folder in Finder/Explorer, selected. */
  'shell.revealPath': {
    input: z.object({ path: z.string() }),
    output: z.object({ revealed: z.boolean() })
  },

  // --- Export -------------------------------------------------------------
  /**
   * Writes text to a file the *user* picks, and returns where it went.
   *
   * Note what is not here: a path. Unlike the two procedures above, this needs
   * no allowlist, because the renderer never names a destination — it proposes
   * a filename and main opens a save dialog. The person choosing the folder is
   * the authorization, and an allowlist on top would only mean refusing to
   * write where they just said to.
   *
   * A null path back means they cancelled, which is an ordinary answer.
   */
  'files.saveText': {
    input: z.object({
      suggestedName: z.string().min(1),
      content: z.string(),
      filters: z.array(z.object({ name: z.string(), extensions: z.array(z.string()) })).optional()
    }),
    output: z.object({ path: z.string().nullable() })
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
export type FileDiff = z.infer<typeof fileDiffSchema>
export type RepoOption = z.infer<typeof repoOptionSchema>
export type BoundRepo = z.infer<typeof boundRepoSchema>
