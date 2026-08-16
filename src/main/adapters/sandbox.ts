import { isAbsolute, relative, resolve } from 'path'
import type { SandboxLevel } from '../../shared/domain'

/**
 * Sandbox enforcement (blueprint §4's `sandbox` axis).
 *
 * Blueprint §3 asks for sandbox levels that are enforced rather than labeled.
 *
 * How the Claude side actually composes, verified by probe runs rather than
 * assumed — `canUseTool` is NOT a complete mediator. The SDK's own classifier
 * decides first, and only calls us for tool uses it would otherwise prompt
 * about; commands it considers safe (`echo hello`, `pwd && ls`) run without
 * ever reaching evaluateToolUse. So this file is a *deny layer over the
 * prompt-worthy set*, not the whole policy:
 *
 *   1. `disallowedTools` removes the write tools from the model's context
 *      entirely at read_only (claudeSandboxOptions).
 *   2. The SDK auto-allows its own read-only command set.
 *   3. Everything else routes here, and this is where a mutation is refused.
 *
 * Empirically the boundary holds where it matters: `touch` and `rm` both reach
 * step 3 and are denied, with the target file confirmed untouched afterwards.
 * Keeping that decision in pure code is what lets enforcement have tests that
 * cost nothing to run and cannot drift when the SDK changes what a permission
 * mode means.
 *
 * Codex is the other way round: its `--sandbox read-only` preset is enforced
 * by the CLI's own OS-level sandbox, which is stronger than anything this
 * process could impose on a subprocess. There we translate the level and let
 * the runtime enforce it (codexSandboxMode).
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
 */
const READ_ONLY_GIT_SUBCOMMANDS = new Set([
  'blame',
  'branch',
  'diff',
  'log',
  'ls-files',
  'ls-tree',
  'remote',
  'shortlog',
  'show',
  'status'
])

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
const GIT_FLAGS_TAKING_A_VALUE = new Set([
  '-c',
  '-C',
  '--git-dir',
  '--work-tree',
  '--namespace',
  '--exec-path'
])

function gitSubcommand(tokens: string[]): string | null {
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]
    if (!token.startsWith('-')) return token
    // `--git-dir=x` carries its value inline; `--git-dir x` eats the next token.
    if (GIT_FLAGS_TAKING_A_VALUE.has(token)) index++
  }
  return null
}

export function isReadOnlyCommand(command: string): boolean {
  const trimmed = command.trim()
  if (trimmed === '' || SHELL_CONTROL.test(trimmed)) return false

  const [head, ...rest] = trimmed.split(/\s+/)
  if (!READ_ONLY_COMMANDS.has(head)) return false

  if (head === 'git') {
    const subcommand = gitSubcommand(rest)
    // `git` with no subcommand just prints usage; harmless but pointless.
    return subcommand !== null && READ_ONLY_GIT_SUBCOMMANDS.has(subcommand)
  }

  // `sed -i` edits in place — the one flag that turns a reader into a writer.
  if (head === 'sed' && rest.some((token) => token === '-i' || token.startsWith('-i'))) {
    return false
  }

  return true
}

/** True when `candidate` resolves to `root` itself or something inside it. */
export function isInsideRepo(root: string, candidate: string): boolean {
  const rel = relative(resolve(root), resolve(root, candidate))
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
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

export interface ClaudeSandboxOptions {
  permissionMode: 'default' | 'acceptEdits' | 'bypassPermissions'
  /** Removed from the model's context entirely, per the SDK's own wording. */
  disallowedTools: string[]
  allowDangerouslySkipPermissions?: boolean
}

/**
 * The backstop layer. evaluateToolUse() is the authority via canUseTool, but a
 * denied tool that the model can still see is a tool it will keep trying, so
 * `read_only` also strips the write tools from its context outright.
 */
export function claudeSandboxOptions(level: SandboxLevel): ClaudeSandboxOptions {
  switch (level) {
    case 'read_only':
      return { permissionMode: 'default', disallowedTools: [...WRITE_TOOLS] }
    case 'workspace_write':
      return { permissionMode: 'acceptEdits', disallowedTools: [] }
    case 'full_access':
      return {
        permissionMode: 'bypassPermissions',
        disallowedTools: [],
        allowDangerouslySkipPermissions: true
      }
  }
}
