import { describe, expect, it } from 'vitest'
import { CLAUDE_CAPABILITIES } from './claude'
import { CODEX_CAPABILITIES } from './codex'
import {
  claudeSandboxOptions,
  codexSandboxMode,
  evaluateToolUse,
  isInsideRepo,
  isReadOnlyCommand,
  osSandboxSupported
} from './sandbox'

/**
 * This is the file making a security claim, so it is the one asserted rather
 * than the SDK's behaviour. Every case here runs offline; the live half — that
 * a denied `touch` and `rm` really do leave the filesystem untouched — is in
 * docs/plan/05-backend-adapters.md.
 */

const REPO = '/tmp/repo'

describe('isReadOnlyCommand', () => {
  it('allows inspection commands', () => {
    for (const command of ['ls -la', 'cat README.md', 'rg TODO', 'wc -l src/a.ts', 'pwd']) {
      expect(isReadOnlyCommand(command), command).toBe(true)
    }
  })

  it('rejects commands that are not on the allowlist at all', () => {
    for (const command of ['touch x', 'rm -rf .', 'npm install', 'echo hi', 'curl example.com']) {
      expect(isReadOnlyCommand(command), command).toBe(false)
    }
  })

  it('allows read-only git subcommands and rejects the writing ones', () => {
    expect(isReadOnlyCommand('git diff')).toBe(true)
    expect(isReadOnlyCommand('git log --oneline -5')).toBe(true)
    expect(isReadOnlyCommand('git commit -m x')).toBe(false)
    expect(isReadOnlyCommand('git checkout main')).toBe(false)
    expect(isReadOnlyCommand('git apply patch')).toBe(false)
    expect(isReadOnlyCommand('git push')).toBe(false)
  })

  it('rejects git subcommands that mutate refs or config, not just the file tree', () => {
    // `branch` and `remote` read in their bare form and write with a flag, and
    // telling those apart means parsing each subcommand's own option grammar.
    // Read-only is the level where the cheap answer is the right one.
    expect(isReadOnlyCommand('git branch -D main')).toBe(false)
    expect(isReadOnlyCommand('git remote add evil https://example.com')).toBe(false)
  })

  it('rejects git -c, which can name a program for git to run', () => {
    // Several config keys hold command lines git executes — diff.external,
    // core.pager, core.sshCommand. Allowing -c while allowlisting the
    // subcommand means the allowlist decides nothing.
    expect(isReadOnlyCommand('git -c diff.external=/bin/false diff')).toBe(false)
    expect(isReadOnlyCommand('git -c core.pager=rm log')).toBe(false)
    expect(isReadOnlyCommand('git --config-env=core.pager=EVIL log')).toBe(false)
    // The reason the -c parsing existed at all still holds for the flags that
    // only ever name a path.
    expect(isReadOnlyCommand('git --git-dir /tmp/x status')).toBe(true)
  })

  it('rejects the find predicates that write, delete or execute', () => {
    // `-exec ... +` carries no shell metacharacter, so SHELL_CONTROL never
    // sees it — find does the executing itself.
    expect(isReadOnlyCommand('find . -name x -delete')).toBe(false)
    expect(isReadOnlyCommand('find . -type f -exec rm {} +')).toBe(false)
    expect(isReadOnlyCommand('find . -execdir rm {} +')).toBe(false)
    expect(isReadOnlyCommand('find . -ok rm {} +')).toBe(false)
    expect(isReadOnlyCommand('find . -fprintf /tmp/pwned hello')).toBe(false)
    expect(isReadOnlyCommand('find . -fls /tmp/out')).toBe(false)
    expect(isReadOnlyCommand('find . -name "*.ts" -type f')).toBe(true)
  })

  it('rejects anything that chains, redirects or substitutes', () => {
    // The whole point: an allowlisted head token must not be able to smuggle a
    // second command in behind it.
    for (const command of [
      'git diff; rm -rf .',
      'ls && touch x',
      'cat a || rm b',
      'ls > out.txt',
      'cat < in.txt',
      'ls | tee out.txt',
      'ls `rm -rf .`',
      'ls $(rm -rf .)',
      'ls\nrm -rf .'
    ]) {
      expect(isReadOnlyCommand(command), command).toBe(false)
    }
  })

  it('rejects sed -i, the one allowlisted reader that can write', () => {
    expect(isReadOnlyCommand('sed -n 1,5p file')).toBe(true)
    expect(isReadOnlyCommand('sed -i s/a/b/ file')).toBe(false)
    expect(isReadOnlyCommand('sed -i.bak s/a/b/ file')).toBe(false)
  })

  it('rejects sed in-place however the flag is spelled', () => {
    // A prefix test on '-i' misses both of these: '-ni' is a short cluster and
    // '--in-place' is the GNU long form.
    expect(isReadOnlyCommand("sed -ni 's/a/b/' file")).toBe(false)
    expect(isReadOnlyCommand('sed --in-place s/a/b/ file')).toBe(false)
    expect(isReadOnlyCommand('sed -ne 1,5p file')).toBe(true)
  })

  it('rejects an empty command', () => {
    expect(isReadOnlyCommand('   ')).toBe(false)
  })
})

describe('isInsideRepo', () => {
  it('accepts the repo itself and paths under it', () => {
    expect(isInsideRepo(REPO, REPO)).toBe(true)
    expect(isInsideRepo(REPO, `${REPO}/src/a.ts`)).toBe(true)
    expect(isInsideRepo(REPO, 'src/a.ts')).toBe(true)
  })

  it('rejects paths that escape, including via ..', () => {
    expect(isInsideRepo(REPO, '/etc/passwd')).toBe(false)
    expect(isInsideRepo(REPO, `${REPO}/../other/a.ts`)).toBe(false)
    expect(isInsideRepo(REPO, '../../etc/passwd')).toBe(false)
  })

  it('does not treat a sibling with a shared prefix as inside', () => {
    expect(isInsideRepo(REPO, '/tmp/repo-other/a.ts')).toBe(false)
  })
})

describe('evaluateToolUse at read_only', () => {
  it('denies every write tool', () => {
    for (const tool of ['Write', 'Edit', 'MultiEdit', 'NotebookEdit']) {
      const decision = evaluateToolUse('read_only', tool, { file_path: `${REPO}/a.ts` }, REPO)
      expect(decision.allowed, tool).toBe(false)
      expect(decision.reason).toContain('read-only')
    }
  })

  it('allows reading tools', () => {
    for (const tool of ['Read', 'Grep', 'Glob', 'WebFetch']) {
      expect(evaluateToolUse('read_only', tool, {}, REPO).allowed, tool).toBe(true)
    }
  })

  it('gates Bash through the command allowlist', () => {
    expect(evaluateToolUse('read_only', 'Bash', { command: 'git diff' }, REPO).allowed).toBe(true)
    const denied = evaluateToolUse('read_only', 'Bash', { command: 'rm -rf .' }, REPO)
    expect(denied.allowed).toBe(false)
    expect(denied.reason).toContain('rm -rf .')
  })

  it('denies Bash with no command at all rather than defaulting open', () => {
    expect(evaluateToolUse('read_only', 'Bash', {}, REPO).allowed).toBe(false)
  })

  it('refuses to leave the sandbox even for an otherwise allowlisted command', () => {
    // `git diff` passes the allowlist on its own; asking to run it unsandboxed
    // does not, because the flag is the request, not the command.
    const decision = evaluateToolUse(
      'read_only',
      'Bash',
      { command: 'git diff', dangerouslyDisableSandbox: true },
      REPO
    )
    expect(decision.allowed).toBe(false)
  })
})

describe('evaluateToolUse at workspace_write', () => {
  it('allows writes inside the repo', () => {
    expect(
      evaluateToolUse('workspace_write', 'Write', { file_path: `${REPO}/src/a.ts` }, REPO).allowed
    ).toBe(true)
  })

  it('denies writes outside the repo', () => {
    const decision = evaluateToolUse('workspace_write', 'Write', { file_path: '/etc/hosts' }, REPO)
    expect(decision.allowed).toBe(false)
    expect(decision.reason).toContain('/etc/hosts')
  })

  it('checks the notebook path field for NotebookEdit', () => {
    expect(
      evaluateToolUse('workspace_write', 'NotebookEdit', { notebook_path: '/etc/x.ipynb' }, REPO)
        .allowed
    ).toBe(false)
  })

  it('allows Bash, since constraining it would mean parsing shell', () => {
    expect(
      evaluateToolUse('workspace_write', 'Bash', { command: 'npm test && rm tmp' }, REPO).allowed
    ).toBe(true)
  })

  // The blanket Bash allowance above is what made this reachable: the SDK's
  // sandbox denied `echo escaped > /tmp/x`, the model reissued it with
  // dangerouslyDisableSandbox, and nothing here said no. Confirmed live before
  // and after the fix.
  it('refuses a command that asks to run outside the sandbox', () => {
    const decision = evaluateToolUse(
      'workspace_write',
      'Bash',
      { command: 'echo escaped > /tmp/x', dangerouslyDisableSandbox: true },
      REPO
    )
    expect(decision.allowed).toBe(false)
    expect(decision.reason).toContain('sandboxed')
  })
})

describe('evaluateToolUse at full_access', () => {
  it('allows everything, including outside the repo', () => {
    expect(evaluateToolUse('full_access', 'Write', { file_path: '/etc/hosts' }, REPO).allowed).toBe(
      true
    )
    expect(evaluateToolUse('full_access', 'Bash', { command: 'rm -rf /' }, REPO).allowed).toBe(true)
  })
})

describe('backend translation', () => {
  it('maps to Codex hyphenated sandbox names', () => {
    // Our domain enum is underscored and Codex's CLI values are hyphenated;
    // assuming they matched would have passed an invalid --sandbox value.
    expect(codexSandboxMode('read_only')).toBe('read-only')
    expect(codexSandboxMode('workspace_write')).toBe('workspace-write')
    expect(codexSandboxMode('full_access')).toBe('danger-full-access')
  })

  it('strips write tools from the Claude context at read_only only', () => {
    expect(claudeSandboxOptions('read_only', REPO).disallowedTools).toEqual(
      expect.arrayContaining(['Write', 'Edit', 'MultiEdit', 'NotebookEdit'])
    )
    expect(claudeSandboxOptions('workspace_write', REPO).disallowedTools).toEqual([])
    expect(claudeSandboxOptions('full_access', REPO).disallowedTools).toEqual([])
  })

  it('only asks to skip permissions at full_access', () => {
    expect(claudeSandboxOptions('read_only', REPO).allowDangerouslySkipPermissions).toBeUndefined()
    expect(
      claudeSandboxOptions('workspace_write', REPO).allowDangerouslySkipPermissions
    ).toBeUndefined()
    expect(claudeSandboxOptions('full_access', REPO).allowDangerouslySkipPermissions).toBe(true)
  })
})

describe('the Claude OS sandbox', () => {
  // These assertions only mean anything where the SDK has an implementation.
  // On Windows the honest answer is "no OS sandbox", asserted separately below.
  const supported = osSandboxSupported()

  it.runIf(supported)('confines writes to nothing at all at read_only', () => {
    const { sandbox } = claudeSandboxOptions('read_only', REPO)
    expect(sandbox?.enabled).toBe(true)
    expect(sandbox?.filesystem?.allowWrite).toEqual([])
  })

  it.runIf(supported)('confines writes to the repo at workspace_write', () => {
    // The gap this closes: evaluateToolUse allows any Bash command at this
    // level, so before the OS sandbox "workspace write" did not constrain
    // writes made through a shell at all.
    const { sandbox } = claudeSandboxOptions('workspace_write', REPO)
    expect(sandbox?.enabled).toBe(true)
    expect(sandbox?.filesystem?.allowWrite).toEqual([REPO])
  })

  it.runIf(supported)('fails loudly rather than running unconfined', () => {
    // A boundary that silently isn't there is worse than one that won't start.
    expect(claudeSandboxOptions('read_only', REPO).sandbox?.failIfUnavailable).toBe(true)
  })

  it.runIf(supported)('keeps our own allowlist in the path', () => {
    // autoAllowBashIfSandboxed would skip canUseTool entirely, and with it the
    // refusal message the model can actually act on.
    expect(claudeSandboxOptions('read_only', REPO).sandbox?.autoAllowBashIfSandboxed).toBe(false)
  })

  it.runIf(supported)('refuses to honour the sandbox escape hatch', () => {
    // The SDK defaults allowUnsandboxedCommands to true, which made
    // allowWrite: [repoPath] confine nothing. Demonstrated live: a
    // workspace_write persona asked to write to /tmp had its first attempt
    // denied, reissued the same command with dangerouslyDisableSandbox, and
    // the file landed. Every level that gets a sandbox must also refuse to
    // give it up.
    expect(claudeSandboxOptions('read_only', REPO).sandbox?.allowUnsandboxedCommands).toBe(false)
    expect(claudeSandboxOptions('workspace_write', REPO).sandbox?.allowUnsandboxedCommands).toBe(
      false
    )
  })

  it.runIf(supported)('passes injected deny-read paths through', () => {
    const secrets = '/tmp/userData/secrets'
    expect(
      claudeSandboxOptions('read_only', REPO, [secrets]).sandbox?.filesystem?.denyRead
    ).toEqual([secrets])
  })

  it('never sandboxes at full_access, which is the point of that level', () => {
    expect(claudeSandboxOptions('full_access', REPO).sandbox).toBeUndefined()
  })

  it('reports enforcement honestly for the platform', () => {
    expect(CLAUDE_CAPABILITIES.sandboxEnforcement).toBe(supported ? 'os' : 'policy')
    // Codex's CLI sandboxes itself wherever it runs.
    expect(CODEX_CAPABILITIES.sandboxEnforcement).toBe('os')
  })
})
