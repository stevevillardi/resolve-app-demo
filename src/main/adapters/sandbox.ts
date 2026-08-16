import type { Options } from '@anthropic-ai/claude-agent-sdk'
import { existsSync, realpathSync } from 'fs'
import { isAbsolute, relative, resolve } from 'path'
import type { SandboxLevel } from '../../shared/domain'

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
}

const ALLOWED: SandboxDecision = { allowed: true }

function deny(reason: string): SandboxDecision {
  return { allowed: false, reason }
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
    return ALLOWED
  }

  return ALLOWED
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
