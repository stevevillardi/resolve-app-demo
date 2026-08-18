import { describe, expect, it } from 'vitest'
import { CLAUDE_CAPABILITIES } from './claude'
import { CODEX_CAPABILITIES } from './codex'
import {
  GITHUB_MCP_ALL_TOOLS,
  GITHUB_MCP_READ_TOOLS,
  GITHUB_MCP_READONLY_URL,
  GITHUB_MCP_URL,
  GITHUB_MCP_WRITE_TOOLS
} from './github-mcp-tools'
import {
  claudeSandboxOptions,
  codexSandboxMode,
  evaluateGithubShellUse,
  evaluateMcpToolUse,
  evaluateToolUse,
  githubMcpDenyList,
  githubMcpDisallowedTools,
  githubMcpEndpoint,
  isInsideRepo,
  isReadOnlyCommand,
  osSandboxSupported
} from './sandbox'
import type { GithubScope, SandboxLevel } from '../../shared/domain'

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

describe('evaluateToolUse at ask_writes', () => {
  it('allows the read_only allowlist without asking', () => {
    for (const command of ['git diff', 'ls -la', 'rg TODO src']) {
      const decision = evaluateToolUse('ask_writes', 'Bash', { command }, REPO)
      expect(decision.allowed, command).toBe(true)
      expect(decision.ask, command).toBeUndefined()
    }
  })

  it('holds every other command for approval rather than denying it', () => {
    for (const command of ['npm test', 'touch x', 'git commit -m x', 'sed -i s/a/b/ f']) {
      const decision = evaluateToolUse('ask_writes', 'Bash', { command }, REPO)
      expect(decision.allowed, command).toBe(false)
      expect(decision.ask, command).toBe(true)
      // The reason doubles as the prompt's description of the act, so it has
      // to name the command a human is being asked to judge.
      expect(decision.reason, command).toContain(command)
    }
  })

  it('holds writes inside the repo for approval', () => {
    const decision = evaluateToolUse('ask_writes', 'Write', { file_path: `${REPO}/a.ts` }, REPO)
    expect(decision.allowed).toBe(false)
    expect(decision.ask).toBe(true)
    expect(decision.reason).toContain(`${REPO}/a.ts`)
  })

  it('still denies writes outside the repo outright — approval widens when, never where', () => {
    const decision = evaluateToolUse('ask_writes', 'Write', { file_path: '/etc/hosts' }, REPO)
    expect(decision.allowed).toBe(false)
    expect(decision.ask).toBeUndefined()
    expect(decision.reason).toContain('/etc/hosts')
  })

  it('still refuses the sandbox-disable flag outright, even on an allowlisted command', () => {
    const decision = evaluateToolUse(
      'ask_writes',
      'Bash',
      { command: 'git diff', dangerouslyDisableSandbox: true },
      REPO
    )
    expect(decision.allowed).toBe(false)
    expect(decision.ask).toBeUndefined()
  })

  it('allows reading tools without asking', () => {
    for (const tool of ['Read', 'Grep', 'Glob']) {
      const decision = evaluateToolUse('ask_writes', tool, {}, REPO)
      expect(decision.allowed, tool).toBe(true)
    }
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

  it('fails ask_writes closed on Codex, which cannot deliver an answer', () => {
    // Persona validation refuses the pairing before a row can exist; if one
    // arrives anyway, the posture's promise — nothing writes without an
    // approval — survives, rather than silently widening to workspace-write.
    expect(codexSandboxMode('ask_writes')).toBe('read-only')
  })

  it('strips write tools from the Claude context at read_only only', () => {
    expect(claudeSandboxOptions('read_only', REPO).disallowedTools).toEqual(
      expect.arrayContaining(['Write', 'Edit', 'MultiEdit', 'NotebookEdit'])
    )
    expect(claudeSandboxOptions('workspace_write', REPO).disallowedTools).toEqual([])
    expect(claudeSandboxOptions('full_access', REPO).disallowedTools).toEqual([])
    // ask_writes keeps them in context: "you may ask" is the point.
    expect(claudeSandboxOptions('ask_writes', REPO).disallowedTools).toEqual([])
  })

  it('gives ask_writes the write grants of workspace_write with the permission mode of read_only', () => {
    // `default` is what keeps canUseTool in the path for every write —
    // acceptEdits would auto-approve the file tools — and the OS sandbox must
    // already allow the write so a human's yes is sufficient.
    const options = claudeSandboxOptions('ask_writes', REPO, [], ['/tmp/extra'])
    expect(options.permissionMode).toBe('default')
    expect(options.allowDangerouslySkipPermissions).toBeUndefined()
    if (osSandboxSupported()) {
      expect(options.sandbox?.filesystem?.allowWrite).toEqual([REPO, '/tmp/extra'])
    }
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

  // A worktree's .git is a file pointing back into the main repo, so a commit
  // writes outside the working directory. Without these paths the session cannot
  // even `git add` — verified against a real sandbox, not inferred.
  const GIT_PATHS = [
    `${REPO}/.git/worktrees/buddy`,
    `${REPO}/.git/objects`,
    `${REPO}/.git/refs`,
    `${REPO}/.git/logs`
  ]

  it.runIf(supported)('adds the git directories a worktree session must write', () => {
    const { sandbox } = claudeSandboxOptions('workspace_write', REPO, [], GIT_PATHS)
    expect(sandbox?.filesystem?.allowWrite).toEqual([REPO, ...GIT_PATHS])
  })

  // The grant is for writing, and a reader does none. Passing it through here
  // would hand a read_only persona write access to the repo's git directory,
  // which is a far larger hole than the one it was meant to close.
  it.runIf(supported)('grants a reader nothing, whatever it is handed', () => {
    const { sandbox } = claudeSandboxOptions('read_only', REPO, [], GIT_PATHS)
    expect(sandbox?.filesystem?.allowWrite).toEqual([])
  })

  it.runIf(supported)('grants nothing extra when the session is in its repo', () => {
    const { sandbox } = claudeSandboxOptions('workspace_write', REPO, [], [])
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

/**
 * The GitHub axis. The whole reason this is a separate table from
 * evaluateToolUse is that the two must not be able to influence each other, so
 * most of what follows is asserting an absence of coupling.
 */
describe('the GitHub MCP gate', () => {
  const SCOPES: GithubScope[] = ['read_only', 'open_pr', 'full_access']

  it('sends read_only to the endpoint that serves no write tool at all', () => {
    expect(githubMcpEndpoint('read_only')).toBe(GITHUB_MCP_READONLY_URL)
    expect(githubMcpEndpoint('open_pr')).toBe(GITHUB_MCP_URL)
    expect(githubMcpEndpoint('full_access')).toBe(GITHUB_MCP_URL)
  })

  it('is a complete transcription of the server — 27 read + 17 write = 44', () => {
    // The deny table is derived from the difference between these two lists, so
    // a partial transcription is a hole rather than a smaller feature.
    expect(GITHUB_MCP_READ_TOOLS).toHaveLength(27)
    expect(GITHUB_MCP_WRITE_TOOLS).toHaveLength(17)
    expect(new Set(GITHUB_MCP_ALL_TOOLS).size).toBe(44)
  })

  it('denies every write tool at read_only, endpoint notwithstanding', () => {
    expect(githubMcpDenyList('read_only')).toEqual([...GITHUB_MCP_WRITE_TOOLS])
  })

  it('denies nothing at full_access, which is what that level means', () => {
    expect(githubMcpDenyList('full_access')).toEqual([])
  })

  it('lets open_pr propose and never merge', () => {
    const denied = githubMcpDenyList('open_pr')
    // The explicit line from blueprint §16.
    expect(denied).toContain('merge_pull_request')
    // A branch and a PR are the whole point of the level.
    expect(denied).not.toContain('create_branch')
    expect(denied).not.toContain('create_pull_request')
    expect(denied).not.toContain('add_issue_comment')
  })

  it('stops open_pr writing file content around git', () => {
    // These four write to a ref over the REST API: no commit, no branch, no
    // sandbox, no diff. A persona denied Edit on disk could rewrite main with
    // them, which is the hole this case exists to keep shut.
    const denied = githubMcpDenyList('open_pr')
    for (const tool of ['push_files', 'create_or_update_file', 'delete_file']) {
      expect(denied, tool).toContain(tool)
    }
    // And acting outside the repo it was bound to.
    expect(denied).toContain('create_repository')
    expect(denied).toContain('fork_repository')
  })

  it('never denies a tool that is not a write tool', () => {
    for (const scope of SCOPES) {
      for (const tool of githubMcpDenyList(scope)) {
        expect(GITHUB_MCP_WRITE_TOOLS, `${scope}/${tool}`).toContain(tool)
      }
    }
  })

  it('is monotonic — a looser scope never denies more than a stricter one', () => {
    // The property that makes the three levels a ladder rather than three
    // unrelated tables. Checked mechanically so a hand-edit that breaks the
    // ordering fails here rather than in production.
    const readOnly = new Set(githubMcpDenyList('read_only'))
    const openPr = new Set(githubMcpDenyList('open_pr'))
    const full = new Set(githubMcpDenyList('full_access'))

    for (const tool of openPr) expect(readOnly, tool).toContain(tool)
    for (const tool of full) expect(openPr, tool).toContain(tool)
    expect(openPr.size).toBeLessThan(readOnly.size)
  })

  /**
   * What each scope can actually reach, once both layers have had their say:
   * the tools the endpoint serves, minus the tools denied by name. This is the
   * only number that describes the feature — either layer read on its own
   * overstates or understates it.
   */
  function reachableWrites(scope: GithubScope): string[] {
    const served: readonly string[] =
      githubMcpEndpoint(scope) === GITHUB_MCP_READONLY_URL
        ? GITHUB_MCP_READ_TOOLS
        : GITHUB_MCP_ALL_TOOLS
    const denied = new Set(githubMcpDenyList(scope))
    return GITHUB_MCP_WRITE_TOOLS.filter((tool) => served.includes(tool) && !denied.has(tool))
  }

  it('leaves read_only unable to reach a single write tool, by either layer', () => {
    expect(reachableWrites('read_only')).toEqual([])
  })

  it('leaves open_pr exactly the eleven tools that propose rather than impose', () => {
    expect(reachableWrites('open_pr')).toEqual([
      'add_comment_to_pending_review',
      'add_issue_comment',
      'add_reply_to_pull_request_comment',
      'create_branch',
      'create_pull_request',
      'issue_write',
      'pull_request_review_write',
      'request_copilot_review',
      'sub_issue_write',
      'update_pull_request',
      'update_pull_request_branch'
    ])
  })

  it('leaves full_access everything, which is what it promises', () => {
    expect(reachableWrites('full_access')).toEqual([...GITHUB_MCP_WRITE_TOOLS])
  })

  it('never reaches a tool the endpoint does not serve', () => {
    // The layers agree by construction, and this is the statement of it: a
    // scope's reachable set is always a subset of what its endpoint serves, so
    // no deny-list edit can create the illusion of access that is not there.
    for (const scope of SCOPES) {
      const served =
        githubMcpEndpoint(scope) === GITHUB_MCP_READONLY_URL
          ? GITHUB_MCP_READ_TOOLS
          : GITHUB_MCP_ALL_TOOLS
      for (const tool of reachableWrites(scope)) {
        expect(served, `${scope}/${tool}`).toContain(tool)
      }
    }
  })

  it('qualifies the same table for disallowedTools, so the layers cannot drift', () => {
    expect(githubMcpDisallowedTools('open_pr')).toEqual(
      githubMcpDenyList('open_pr').map((tool) => `mcp__github__${tool}`)
    )
  })
})

describe('evaluateMcpToolUse', () => {
  it('accepts the qualified name the SDK actually passes', () => {
    const denied = evaluateMcpToolUse('read_only', 'mcp__github__add_issue_comment')
    expect(denied.allowed).toBe(false)
    // Named in the reason so the model can say what it could not do, rather
    // than reporting an empty result as though it had looked.
    expect(denied.reason).toContain('add_issue_comment')
  })

  it('accepts a bare name too', () => {
    expect(evaluateMcpToolUse('read_only', 'add_issue_comment').allowed).toBe(false)
  })

  it('allows reads at every scope', () => {
    for (const scope of ['read_only', 'open_pr', 'full_access'] as GithubScope[]) {
      expect(evaluateMcpToolUse(scope, 'mcp__github__list_issues').allowed, scope).toBe(true)
    }
  })

  it('leaves the other axis alone', () => {
    // Bash and Edit arrive through the same canUseTool callback. This gate must
    // pass them through untouched or it would be deciding filesystem policy.
    expect(evaluateMcpToolUse('read_only', 'Bash').allowed).toBe(true)
    expect(evaluateMcpToolUse('read_only', 'Edit').allowed).toBe(true)
  })

  it('says something different at open_pr than at read_only', () => {
    const readOnly = evaluateMcpToolUse('read_only', 'mcp__github__merge_pull_request')
    const openPr = evaluateMcpToolUse('open_pr', 'mcp__github__merge_pull_request')
    expect(readOnly.allowed).toBe(false)
    expect(openPr.allowed).toBe(false)
    expect(openPr.reason).not.toBe(readOnly.reason)
    // The open_pr wording tells the model what it *can* do instead.
    expect(openPr.reason).toContain('Propose')
  })
})

describe('the two axes are independent', () => {
  /**
   * The finding this phase was built around. `sandbox: full_access` sets
   * `permissionMode: 'bypassPermissions'`, under which the SDK stops consulting
   * canUseTool entirely — so a GitHub decision keyed off the sandbox level
   * would hand every full-disk persona merge rights nobody granted it.
   *
   * These cases assert the axes never read each other. The name blacklist is
   * what makes that survivable at runtime: `disallowedTools` was measured to
   * hold under bypassPermissions, which is why githubMcpDisallowedTools()
   * exists at all.
   */
  it('keeps GitHub narrow for a persona with full disk access', () => {
    expect(claudeSandboxOptions('full_access', REPO).permissionMode).toBe('bypassPermissions')
    // Same persona, read_only on GitHub: still all 17.
    expect(githubMcpDenyList('read_only')).toHaveLength(17)
    expect(githubMcpDisallowedTools('read_only')).toHaveLength(17)
  })

  it('keeps the disk narrow for a persona with full GitHub access', () => {
    expect(githubMcpDenyList('full_access')).toEqual([])
    const decision = evaluateToolUse('read_only', 'Write', { file_path: `${REPO}/a.ts` }, REPO)
    expect(decision.allowed).toBe(false)
  })

  it('resolves all nine sandbox/scope combinations without either reading the other', () => {
    const levels: SandboxLevel[] = ['read_only', 'workspace_write', 'full_access']
    const scopes: GithubScope[] = ['read_only', 'open_pr', 'full_access']
    const expected = {
      read_only: 17,
      open_pr: 6,
      full_access: 0
    }

    for (const level of levels) {
      for (const scope of scopes) {
        // The deny list depends on the scope and on nothing else. If a future
        // edit threads `level` into it, this fails for eight of the nine.
        expect(githubMcpDenyList(scope), `${level}/${scope}`).toHaveLength(expected[scope])
      }
    }
  })
})

/**
 * The route around the MCP gate, found by running the live check.
 *
 * A `githubScope: read_only` persona at `sandbox: workspace_write` was asked to
 * comment on an issue. The MCP layer refused correctly — the read-only endpoint
 * serves no write tool, and the model said so — and it then ran
 * `gh issue comment` from the shell and the comment appeared. Both governance
 * layers had worked and the outcome was still wrong, because githubScope had
 * only ever been applied to MCP tool names.
 *
 * These are written from that claim: a persona that cannot comment through a
 * tool must not be able to comment through a shell either.
 */
describe('the GitHub axis applied to the shell', () => {
  const bash = (command: string): Record<string, unknown> => ({ command })

  it('denies gh writes at read_only', () => {
    expect(
      evaluateGithubShellUse('read_only', 'Bash', bash('gh issue comment 5 -b x')).allowed
    ).toBe(false)
    expect(evaluateGithubShellUse('read_only', 'Bash', bash('gh pr create')).allowed).toBe(false)
  })

  it('allows gh reads at read_only, which is what the scope is for', () => {
    // "Can read issues and code on GitHub" has to stay true, or the level
    // becomes indistinguishable from having no GitHub access at all.
    expect(evaluateGithubShellUse('read_only', 'Bash', bash('gh issue list')).allowed).toBe(true)
    expect(evaluateGithubShellUse('read_only', 'Bash', bash('gh pr view 1')).allowed).toBe(true)
  })

  it('treats an unrecognised gh action as a write', () => {
    // Fails closed: a subcommand added by a future gh release is denied rather
    // than allowed, which is the safe direction for a deny list over a moving
    // target.
    expect(evaluateGithubShellUse('read_only', 'Bash', bash('gh issue frobnicate 5')).allowed).toBe(
      false
    )
  })

  it('denies git push at read_only and allows it at open_pr', () => {
    // Pushing a branch is how a pull request comes to exist, so open_pr keeps
    // it — the level would be unusable otherwise.
    expect(evaluateGithubShellUse('read_only', 'Bash', bash('git push origin x')).allowed).toBe(
      false
    )
    expect(evaluateGithubShellUse('open_pr', 'Bash', bash('git push origin x')).allowed).toBe(true)
  })

  it('denies a merge at open_pr, matching the MCP deny list', () => {
    // The same boundary githubMcpDenyList draws for merge_pull_request. Two
    // routes to one API, and they have to agree or the narrower one is theatre.
    expect(evaluateGithubShellUse('open_pr', 'Bash', bash('gh pr merge 1')).allowed).toBe(false)
    expect(evaluateGithubShellUse('open_pr', 'Bash', bash('gh issue comment 5 -b x')).allowed).toBe(
      true
    )
  })

  it('denies a POST to the GitHub API and allows a GET', () => {
    expect(
      evaluateGithubShellUse(
        'read_only',
        'Bash',
        bash('curl -X POST https://api.github.com/repos/a/b/issues/1/comments')
      ).allowed
    ).toBe(false)
    expect(
      evaluateGithubShellUse('read_only', 'Bash', bash('curl https://api.github.com/repos/a/b'))
        .allowed
    ).toBe(true)
  })

  it('ignores curl aimed at anything that is not GitHub', () => {
    // This axis governs GitHub. Denying every POST anywhere would be the
    // filesystem axis's job and a different decision.
    expect(
      evaluateGithubShellUse('read_only', 'Bash', bash('curl -X POST https://example.com/x'))
        .allowed
    ).toBe(true)
  })

  it('lets ordinary work through untouched', () => {
    for (const command of ['npm test', 'git status', 'ls -la', 'rg auth src/']) {
      expect(evaluateGithubShellUse('read_only', 'Bash', bash(command)).allowed).toBe(true)
    }
  })

  it('governs nothing but Bash', () => {
    expect(evaluateGithubShellUse('read_only', 'Read', { file_path: '/a/b' }).allowed).toBe(true)
  })

  it('allows everything at full_access', () => {
    // Not because it is safe, but because it is the level that means "no
    // GitHub restriction" — and at sandbox: full_access this is never consulted
    // anyway, since bypassPermissions stops the SDK asking. See
    // docs/plan/15-deferred-capability-work.md.
    expect(evaluateGithubShellUse('full_access', 'Bash', bash('gh pr merge 1')).allowed).toBe(true)
  })

  it('is independent of the filesystem axis', () => {
    // The whole point. evaluateToolUse allows `gh issue comment` at
    // workspace_write, and this refuses it — so the two axes compose rather
    // than one overriding the other.
    expect(
      evaluateToolUse('workspace_write', 'Bash', bash('gh issue comment 5 -b x'), '/r').allowed
    ).toBe(true)
    expect(
      evaluateGithubShellUse('read_only', 'Bash', bash('gh issue comment 5 -b x')).allowed
    ).toBe(false)
  })
})
