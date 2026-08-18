import type { Options } from '@anthropic-ai/claude-agent-sdk'
import { existsSync, realpathSync } from 'fs'
import { isAbsolute, relative, resolve } from 'path'
import type { GithubScope, SandboxLevel } from '../../shared/domain'
import {
  bareGithubToolName,
  GITHUB_MCP_READONLY_URL,
  GITHUB_MCP_URL,
  GITHUB_MCP_WRITE_TOOLS,
  qualifiedGithubToolName
} from './github-mcp-tools'

/**
 * Sandbox enforcement (blueprint §4's `sandbox` axis).
 *
 * Blueprint §3 asks for sandbox levels that are enforced rather than labeled.
 * There are two layers here, and the order matters:
 *
 *   1. **The OS sandbox does the enforcing.** Both SDKs can confine the
 *      commands they run at the operating-system level — Codex via its
 *      `--sandbox` preset, Claude via `Options.sandbox` (claudeSandboxOptions).
 *      Neither can be talked out of it by a cleverly written command line.
 *   2. **This file's allowlist is a second layer**, running in-process through
 *      `canUseTool`. It refuses obvious mutations early, with a message the
 *      model can act on, and it has tests that cost nothing to run.
 *
 * The layering is deliberate and was not always this way. The first cut of
 * Phase 5 made layer 2 the *only* Claude-side policy, which meant a hand-rolled
 * shell parser was the entire security boundary — the exact thing the comment
 * on SHELL_CONTROL says not to hand-roll. A post-phase review found real
 * escapes through it (`find . -delete`, `sed -ni`, `git -c diff.external=…`),
 * all now covered in sandbox.test.ts. They are fixed below, but the reason they
 * stopped being frightening is layer 1, not the patches.
 *
 * What layer 2 is NOT: a complete mediator. Verified by probe runs — the SDK's
 * own classifier decides first and only calls `canUseTool` for tool uses it
 * would otherwise prompt about, so commands it considers safe (`echo hello`,
 * `pwd && ls`) never reach evaluateToolUse at all. Treat it as a deny layer
 * over the prompt-worthy set.
 */

export interface SandboxDecision {
  allowed: boolean
  /** Present when denied — surfaced to the model and to the error bubble. */
  reason?: string
  /**
   * Denied *unless a human approves* (Phase 24, review §E1). Only ever set at
   * `ask_writes`, and only on actions that level exists to mediate: a write
   * inside the repo boundary. Everything that is denied at `workspace_write`
   * — a write outside the repo, the sandbox-disable flag — stays a plain deny
   * here too, because approval widens *when* a write may happen, never *where*.
   */
  ask?: true
}

const ALLOWED: SandboxDecision = { allowed: true }

function deny(reason: string): SandboxDecision {
  return { allowed: false, reason }
}

/** Held for a human. `reason` doubles as the prompt's description of the act. */
function ask(reason: string): SandboxDecision {
  return { allowed: false, ask: true, reason }
}

/** Tools that modify files. Denied outright at `read_only`. */
const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit'])

/**
 * Tools whose input names a path we can check against the repo boundary.
 * The key is the tool, the value is the input field holding the path.
 */
const PATH_FIELD_BY_TOOL: Record<string, string> = {
  Write: 'file_path',
  Edit: 'file_path',
  MultiEdit: 'file_path',
  NotebookEdit: 'notebook_path'
}

/**
 * Shell commands a `read_only` session may run.
 *
 * Deliberately short and inspection-only. A read-only reviewer that cannot run
 * `git diff` is much less useful for blueprint §16 Journey 1, which is why
 * Bash is not simply banned at this level — but everything here reports on the
 * repo rather than changing it.
 */
const READ_ONLY_COMMANDS = new Set([
  'cat',
  'diff',
  'file',
  'find',
  'git',
  'grep',
  'head',
  'ls',
  'pwd',
  'rg',
  'sed',
  'stat',
  'tail',
  'tree',
  'wc',
  'which'
])

/**
 * `git` subcommands that only read. Everything else — commit, checkout, apply,
 * push, clean, reset — is a mutation, and `git` is the one allowed command
 * that can write.
 *
 * `branch` and `remote` were here and are not any more: both read in their bare
 * form and write with a flag (`git branch -D`, `git remote add`), and telling
 * those apart means implementing each subcommand's own option grammar. At
 * read_only the cheap answer is the right one.
 */
const READ_ONLY_GIT_SUBCOMMANDS = new Set([
  'blame',
  'diff',
  'log',
  'ls-files',
  'ls-tree',
  'shortlog',
  'show',
  'status'
])

/**
 * Per-command flags that turn an allowlisted reader into a writer or an
 * executor. Keyed by the head token; matched against the whole argument list.
 *
 * `find` is the sharp one. Its write predicates need no shell metacharacter, so
 * SHELL_CONTROL never sees them — `find . -type f -exec rm {} +` terminates
 * with `+` rather than `;`, and find does the executing itself.
 */
const DENIED_FLAGS_BY_COMMAND: Record<string, Set<string>> = {
  find: new Set([
    '-delete',
    '-exec',
    '-execdir',
    '-ok',
    '-okdir',
    '-fprint',
    '-fprint0',
    '-fprintf',
    '-fls'
  ])
}

/**
 * git's own global flags that can name a program for git to run, which would
 * make the subcommand allowlist decide nothing at all: `-c` sets arbitrary
 * config, and several keys hold command lines git executes (`diff.external`,
 * `core.pager`, `core.sshCommand`). `--exec-path` repoints the directory git
 * loads its subcommand binaries from.
 */
const DENIED_GIT_GLOBAL_FLAGS = new Set(['-c', '--config-env', '--exec-path'])

/**
 * Shell syntax that chains, redirects, or substitutes — any of which would let
 * an allowlisted head token carry an arbitrary second command behind it
 * (`git diff; rm -rf .`). Rejecting the whole command is the only safe reading:
 * parsing shell well enough to allow these is not a thing to hand-roll inside
 * a security boundary.
 */
const SHELL_CONTROL = /[;&|><`\n]|\$\(/

/**
 * git's global flags come *before* the subcommand, and several take a separate
 * value — so the first non-dash token is not reliably the subcommand
 * (`git -c core.pager=cat status` would otherwise read as `core.pager=cat`).
 * Returns null when no subcommand is found, which the caller treats as a deny.
 */
const GIT_FLAGS_TAKING_A_VALUE = new Set(['-C', '--git-dir', '--work-tree', '--namespace'])

function gitSubcommand(tokens: string[]): string | null {
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]
    if (!token.startsWith('-')) return token
    // `--config-env=x` carries its value inline, so compare on the flag name.
    if (DENIED_GIT_GLOBAL_FLAGS.has(token.split('=')[0])) return null
    // `--git-dir=x` carries its value inline; `--git-dir x` eats the next token.
    if (GIT_FLAGS_TAKING_A_VALUE.has(token)) index++
  }
  return null
}

/**
 * True when any token asks sed to edit in place.
 *
 * A prefix test on `-i` is not enough: `--in-place` is the GNU long form, and
 * short flags cluster, so `-ni` is `-n -i` with an empty suffix. Both were
 * allowed by the original check.
 */
function sedWritesInPlace(tokens: string[]): boolean {
  return tokens.some((token) => {
    if (token === '--in-place' || token.startsWith('--in-place=')) return true
    if (!token.startsWith('-') || token.startsWith('--')) return false
    // A short cluster ends at the first flag taking a value; -i's optional
    // suffix runs to the end of the token, so anywhere in the cluster counts.
    return token.slice(1).includes('i')
  })
}

export function isReadOnlyCommand(command: string): boolean {
  const trimmed = command.trim()
  if (trimmed === '' || SHELL_CONTROL.test(trimmed)) return false

  const [head, ...rest] = trimmed.split(/\s+/)
  if (!READ_ONLY_COMMANDS.has(head)) return false

  const deniedFlags = DENIED_FLAGS_BY_COMMAND[head]
  if (deniedFlags && rest.some((token) => deniedFlags.has(token.split('=')[0]))) {
    return false
  }

  if (head === 'git') {
    const subcommand = gitSubcommand(rest)
    // `git` with no subcommand just prints usage; harmless but pointless.
    return subcommand !== null && READ_ONLY_GIT_SUBCOMMANDS.has(subcommand)
  }

  if (head === 'sed' && sedWritesInPlace(rest)) return false

  return true
}

/**
 * True when `candidate` resolves to `root` itself or something inside it.
 *
 * Symlinks are resolved where the path already exists, so a link planted inside
 * the repo cannot point the write somewhere else (`repo/link -> /etc`). A path
 * that doesn't exist yet is compared lexically, which is correct — it is about
 * to be created, and its parent chain is what was checked.
 */
export function isInsideRepo(root: string, candidate: string): boolean {
  const realRoot = realPathOrSelf(resolve(root))
  const target = realPathOrSelf(resolve(realRoot, candidate))
  const rel = relative(realRoot, target)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

function realPathOrSelf(path: string): string {
  try {
    return existsSync(path) ? realpathSync(path) : path
  } catch {
    // A broken link or an unreadable parent: fall back to the lexical form
    // rather than letting the check throw and take the whole turn down.
    return path
  }
}

/**
 * The decision point. Called for every tool use in a Claude session, and
 * exercised directly by the tests — this is the function making the security
 * claim, so it is the one that gets asserted rather than the SDK's behaviour.
 */
export function evaluateToolUse(
  level: SandboxLevel,
  toolName: string,
  input: Record<string, unknown>,
  repoPath: string
): SandboxDecision {
  if (level === 'full_access') return ALLOWED

  if (toolName === 'Bash') {
    const command = typeof input.command === 'string' ? input.command : ''

    // The SDK lets a model reissue a sandbox-denied command with this flag to
    // run it unconfined. `allowUnsandboxedCommands: false` already makes the
    // SDK ignore it, but this layer is what turns a silent bypass into a
    // sentence the model can act on — and it holds on platforms where there is
    // no OS sandbox to configure at all. Never legitimate below full_access,
    // which returned above.
    if (input.dangerouslyDisableSandbox === true) {
      return deny(`This persona always runs sandboxed and cannot disable it. Refused: ${command}`)
    }

    if (level === 'read_only') {
      return isReadOnlyCommand(command)
        ? ALLOWED
        : deny(
            `This persona is read-only, so it can only run inspection commands. Refused: ${command}`
          )
    }
    // ask_writes reuses read_only's classifier as the line between "runs
    // freely" and "waits for a human": the allowlist is exactly the set of
    // commands already trusted to change nothing, so everything outside it is
    // the set a human said they wanted to see. A false positive here costs one
    // click; at read_only it costs the whole command.
    if (level === 'ask_writes') {
      return isReadOnlyCommand(command) ? ALLOWED : ask(command)
    }
    // workspace_write: the command runs with the cwd inside the repo, and
    // constraining it further would mean parsing shell, which the comment on
    // SHELL_CONTROL explains we are not doing. The repo boundary for writes is
    // enforced on the file tools below.
    return ALLOWED
  }

  if (WRITE_TOOLS.has(toolName)) {
    if (level === 'read_only') {
      return deny(`This persona is read-only, so it cannot use ${toolName}.`)
    }

    const field = PATH_FIELD_BY_TOOL[toolName]
    const target = typeof input[field] === 'string' ? (input[field] as string) : null
    if (target && !isInsideRepo(repoPath, target)) {
      return deny(`This persona can only write inside its repo. Refused: ${target}`)
    }
    // After the boundary check, deliberately: an approval can say yes to a
    // write, never to where it lands.
    if (level === 'ask_writes') return ask(target ?? toolName)
    return ALLOWED
  }

  return ALLOWED
}

// --- The GitHub axis --------------------------------------------------------

/**
 * `githubScope` enforcement for MCP tool calls — blueprint §4's *other* axis.
 *
 * Deliberately not folded into evaluateToolUse(), which opens with
 * `if (level === 'full_access') return ALLOWED`. Keying a GitHub decision off
 * the filesystem level would mean a persona granted full disk access silently
 * acquired merge rights it was never given, and the two axes are independent by
 * construction or they are not independent at all.
 *
 * Two layers again, for the same reason the file's header describes:
 *
 *   1. **The endpoint, enforced by GitHub.** `read_only` gets `/mcp/readonly`,
 *      which does not serve a single write tool. Nothing we do client-side can
 *      weaken that.
 *   2. **A name blacklist**, because layer 1 covers only the scope→URL mapping
 *      and `sandbox: full_access` sets `permissionMode: 'bypassPermissions'`,
 *      under which `canUseTool` is not consulted at all. `disallowedTools` was
 *      measured to survive it; it is the only gate here that does.
 *
 * Both layers read the same table below, so they cannot drift apart.
 *
 * A third gate was considered and **measured not to work**. The Claude SDK types
 * a per-server, per-tool `permission_policy: 'always_deny'`
 * (`McpHttpServerConfig.tools[]`, sdk.d.ts:1125), which would be stronger than a
 * name blacklist because the CLI enforces it per server rather than by matching
 * a string. `npm run probe:mcp -- --policy` set it on `search_issues`, left the
 * name out of `disallowedTools`, and ran under `bypassPermissions`: **the tool
 * was called and returned results.** So the policy does not survive bypass, and
 * `disallowedTools` staying primary is load-bearing rather than merely cautious.
 * Measured 2026-08-17 against @anthropic-ai/claude-agent-sdk 0.3.233.
 */

/** Written on a branch, reviewable as a diff, revertible. `open_pr` keeps these. */
const OPEN_PR_DENIED = new Set([
  // Blueprint §16 is explicit: propose, do not merge.
  'merge_pull_request',
  // These four write file content straight to a ref over the REST API. No
  // commit the user made, no branch the sandbox fenced, no diff anybody could
  // review — a persona denied Edit on disk could rewrite main through them.
  'push_files',
  'create_or_update_file',
  'delete_file',
  // Creating a repository, or a fork, is acting outside the one repo this
  // Contact was bound to. `open_pr` means "propose a change to *this*".
  'create_repository',
  'fork_repository'
])

/** Which endpoint this scope talks to. GitHub does the enforcing. */
export function githubMcpEndpoint(scope: GithubScope): string {
  return scope === 'read_only' ? GITHUB_MCP_READONLY_URL : GITHUB_MCP_URL
}

/**
 * Bare tool names this scope must never call, in the order the inventory lists
 * them so the output is stable enough to assert on.
 *
 * `read_only` denies every write tool even though its endpoint serves none of
 * them: belt and braces costs nothing and means a future change to the endpoint
 * mapping cannot quietly open a door.
 */
export function githubMcpDenyList(scope: GithubScope): string[] {
  if (scope === 'full_access') return []
  if (scope === 'read_only') return [...GITHUB_MCP_WRITE_TOOLS]
  return GITHUB_MCP_WRITE_TOOLS.filter((tool) => OPEN_PR_DENIED.has(tool))
}

/** The same table as `disallowedTools`, in the qualified form both take. */
export function githubMcpDisallowedTools(scope: GithubScope): string[] {
  return githubMcpDenyList(scope).map(qualifiedGithubToolName)
}

/**
 * The in-process half, called first in the adapter's `canUseTool`. Accepts
 * either the qualified name the SDK passes (`mcp__github__merge_pull_request`)
 * or a bare one, and returns ALLOWED for anything that is not this server's —
 * a Bash call arrives through the same callback and belongs to the other axis.
 */
/**
 * Commands that reach GitHub without going near the MCP server.
 *
 * The hole this closes was found by running the live check rather than by
 * reading anything: a `githubScope: read_only` persona at
 * `sandbox: workspace_write` was asked to comment on an issue, found no MCP
 * write tool — the endpoint genuinely does not serve one — and then ran
 * `gh issue comment` from the shell, using the developer's own `gh`
 * credentials. The comment appeared on the issue. Measured 2026-08-17.
 *
 * Both governance layers had worked exactly as designed and the outcome was
 * still wrong, because `githubScope` was only ever applied to MCP tool names.
 * A developer machine has `gh` on the PATH, `git` with push credentials, and
 * `curl`; any of those is a route to the same API.
 *
 * **This is a deny-list over a heuristic, and it can be evaded.** SHELL_CONTROL
 * already rejects chaining and substitution, which removes the easy escapes,
 * but a determined model could still write a script to a file and run it. It
 * raises the cost of walking around the axis from "type the obvious command" to
 * "deliberately work around a stated restriction", which is the difference
 * between an accident and a decision. What it is *not* is a boundary — see
 * docs/plan/15-deferred-capability-work.md for the part that cannot be fixed
 * in this process at all.
 */
const GITHUB_REACHING_HEADS = new Set(['gh', 'curl', 'wget', 'http', 'https'])

/** `gh` subcommands that only read. Everything else on `gh` is treated as write. */
const GH_READ_SUBCOMMANDS = new Set(['auth', 'browse', 'search', 'status', 'version', 'help'])
const GH_READ_ACTIONS = new Set(['list', 'view', 'status', 'diff', 'checks'])

function ghIsWrite(tokens: string[]): boolean {
  const [subcommand, action] = tokens.filter((token) => !token.startsWith('-'))
  if (!subcommand) return false
  if (GH_READ_SUBCOMMANDS.has(subcommand)) return false
  // `gh issue list` reads; `gh issue comment` writes. An unrecognised action is
  // treated as a write, so a subcommand added by a future gh release fails
  // closed rather than open.
  return !action || !GH_READ_ACTIONS.has(action)
}

/**
 * The shell half of `githubScope`, called alongside evaluateMcpToolUse.
 *
 * Returns ALLOWED for everything that is not a GitHub-reaching command, so an
 * ordinary `npm test` or `git status` falls straight through. Only ever
 * narrows: `full_access` returns ALLOWED immediately, and this is never
 * consulted at `sandbox: full_access` at all, because that sets
 * `bypassPermissions` and the SDK stops asking.
 */
export function evaluateGithubShellUse(
  scope: GithubScope,
  toolName: string,
  input: Record<string, unknown>
): SandboxDecision {
  if (scope === 'full_access' || toolName !== 'Bash') return ALLOWED

  const command = typeof input.command === 'string' ? input.command.trim() : ''
  if (command === '') return ALLOWED

  const [head, ...rest] = command.split(/\s+/)

  if (head === 'git') {
    const subcommand = gitSubcommand(rest)
    // `push` is how a branch becomes a pull request, so open_pr keeps it.
    if (subcommand === 'push' && scope === 'read_only') {
      return deny(
        'This persona has read-only GitHub access, so it cannot push. Refused: ' + command
      )
    }
    return ALLOWED
  }

  if (!GITHUB_REACHING_HEADS.has(head)) return ALLOWED

  if (head === 'gh') {
    if (!ghIsWrite(rest)) return ALLOWED
    const merging = rest.includes('merge')
    if (scope === 'read_only') {
      return deny(
        `This persona has read-only GitHub access, so it cannot run this. Refused: ${command}`
      )
    }
    if (merging) {
      return deny(`This persona can open pull requests but not merge them. Refused: ${command}`)
    }
    return ALLOWED
  }

  // curl and friends: only the ones actually aimed at GitHub, and only when
  // they are not plain reads. A GET to the API is within read_only's remit.
  if (!/github\.com/i.test(command)) return ALLOWED
  const writesOverHttp =
    /\s-X\s*(POST|PUT|PATCH|DELETE)|--request\s*(POST|PUT|PATCH|DELETE)|(^|\s)(-d|--data)(\s|=)/i.test(
      command
    )
  if (!writesOverHttp) return ALLOWED

  return deny(
    scope === 'read_only'
      ? `This persona has read-only GitHub access, so it cannot write to GitHub. Refused: ${command}`
      : `This persona cannot write to GitHub outside its pull-request scope. Refused: ${command}`
  )
}

export function evaluateMcpToolUse(scope: GithubScope, toolName: string): SandboxDecision {
  const bare = bareGithubToolName(toolName) ?? toolName
  if (!githubMcpDenyList(scope).includes(bare)) return ALLOWED

  return deny(
    scope === 'read_only'
      ? `This persona has read-only GitHub access, so it cannot use ${bare}.`
      : `This persona can open pull requests but not ${bare}. Propose the change instead.`
  )
}

// --- Backend option translation ---------------------------------------------

/**
 * Codex's own sandbox names, which are hyphenated where blueprint §4's are
 * underscored. Assuming the two agreed would have silently passed an invalid
 * `--sandbox` value.
 */
export function codexSandboxMode(
  level: SandboxLevel
): 'read-only' | 'workspace-write' | 'danger-full-access' {
  switch (level) {
    case 'read_only':
      return 'read-only'
    // Codex cannot hold a turn open for a human's answer (see
    // askBeforeWritesSupported in shared/domain.ts), and persona validation
    // refuses the pairing before a row can exist. If one arrives here anyway,
    // fail toward the posture's promise — nothing writes without an approval
    // that this backend has no way to collect — rather than silently widening
    // to workspace-write.
    case 'ask_writes':
      return 'read-only'
    case 'workspace_write':
      return 'workspace-write'
    case 'full_access':
      return 'danger-full-access'
  }
}

/**
 * Platforms where the Claude SDK can actually start an OS sandbox — macOS via
 * Seatbelt, Linux via bubblewrap. There is no Windows implementation, so on
 * Windows the level is honestly reported as policy-only rather than being
 * quietly downgraded.
 */
const OS_SANDBOX_PLATFORMS = new Set(['darwin', 'linux'])

export function osSandboxSupported(): boolean {
  return OS_SANDBOX_PLATFORMS.has(process.platform)
}

/**
 * Taken from the SDK rather than hand-declared, so a change to its sandbox
 * schema is a compile error here instead of an option silently ignored at
 * runtime. Type-only, so this stays an erased import and the file keeps its
 * no-runtime-dependencies property.
 */
export type ClaudeOsSandbox = NonNullable<Options['sandbox']>

export interface ClaudeSandboxOptions {
  permissionMode: 'default' | 'acceptEdits' | 'bypassPermissions'
  /** Removed from the model's context entirely, per the SDK's own wording. */
  disallowedTools: string[]
  allowDangerouslySkipPermissions?: boolean
  /** Absent at full_access, and on platforms with no sandbox implementation. */
  sandbox?: ClaudeOsSandbox
}

/**
 * Translates a level into the SDK's options.
 *
 * `sandbox` is the layer that does the enforcing (see the file header).
 * Two choices in it are load-bearing:
 *
 * - `failIfUnavailable: true`. If the sandbox cannot start, the turn fails
 *   loudly instead of running unconfined. A security boundary that silently
 *   isn't there is worse than one that refuses to start, and the SDK's own
 *   default for this option flips to true anyway when `enabled` is passed
 *   explicitly. On platforms with no implementation we don't ask at all, so
 *   this never fires as a surprise — it only fires when the sandbox was
 *   supposed to work and didn't.
 * - `autoAllowBashIfSandboxed: false`. With the OS confining writes it would be
 *   safe to let every command through, but keeping the in-process allowlist in
 *   the path means a refused command comes back as a sentence the model can
 *   act on ("this persona is read-only") rather than an opaque OS error.
 * - `allowUnsandboxedCommands: false`. **Defaults to true**, and that default
 *   is a hole with a demonstration: a `workspace_write` persona bound to a
 *   scratch repo was asked to `echo escaped > /tmp/outside-the-repo.txt`. The
 *   first attempt failed against the sandbox; the model reissued the identical
 *   command with `dangerouslyDisableSandbox`, the SDK honoured it, and the file
 *   landed in /tmp. `allowWrite: [repoPath]` was correct the whole time and
 *   confined nothing, because the escape hatch is a separate switch. With this
 *   false the SDK ignores the parameter entirely and every command stays
 *   sandboxed. See also the `dangerouslyDisableSandbox` check in
 *   evaluateToolUse, which refuses the same request one layer earlier.
 *
 * @param repoPath absolute path to the session's repo — the write boundary at
 *   workspace_write, which is what finally makes that level mean something for
 *   Bash rather than only for the file tools.
 * @param denyReadPaths extra paths to keep out of the agent's reach entirely.
 *   Injected because this layer may not import electron and so cannot resolve
 *   the app's own userData directory (see AdapterConfig.denyReadPaths).
 * @param writablePaths directories outside the repo that must still be writable.
 *   Empty for a Contact working in its repo. For one working in a `git
 *   worktree` it carries the parts of the main repo's git directory that a
 *   commit touches: a worktree's `.git` is a *file* pointing back into the main
 *   repo, so `allowWrite: [repoPath]` alone fails at `git add`. Resolved by
 *   gitWritePathsFor() rather than assembled here — this layer may not run git
 *   any more than it may import electron.
 */
export function claudeSandboxOptions(
  level: SandboxLevel,
  repoPath: string,
  denyReadPaths: string[] = [],
  writablePaths: string[] = []
): ClaudeSandboxOptions {
  const filesystem = (allowWrite: string[]): ClaudeOsSandbox['filesystem'] => ({
    allowWrite,
    ...(denyReadPaths.length > 0 ? { denyRead: denyReadPaths } : {})
  })

  const osSandbox = (allowWrite: string[]): { sandbox?: ClaudeOsSandbox } =>
    osSandboxSupported()
      ? {
          sandbox: {
            enabled: true,
            failIfUnavailable: true,
            autoAllowBashIfSandboxed: false,
            allowUnsandboxedCommands: false,
            filesystem: filesystem(allowWrite)
          }
        }
      : {}

  switch (level) {
    case 'read_only':
      return {
        permissionMode: 'default',
        disallowedTools: [...WRITE_TOOLS],
        ...osSandbox([])
      }
    // The write grants of workspace_write with the permission mode of
    // read_only. `default` is what keeps canUseTool in the path for every
    // write — `acceptEdits` would auto-approve the file tools, which is the
    // one thing this level exists not to do — and the OS sandbox must already
    // allow the write so that a human's yes is sufficient. The write tools
    // stay in context: unlike read_only, "you may ask" is the point.
    case 'ask_writes':
      return {
        permissionMode: 'default',
        disallowedTools: [],
        ...osSandbox([repoPath, ...writablePaths])
      }
    case 'workspace_write':
      return {
        permissionMode: 'acceptEdits',
        disallowedTools: [],
        ...osSandbox([repoPath, ...writablePaths])
      }
    case 'full_access':
      // No OS sandbox by definition — this is the level whose whole point is
      // that the persona can touch the machine.
      return {
        permissionMode: 'bypassPermissions',
        disallowedTools: [],
        allowDangerouslySkipPermissions: true
      }
  }
}
