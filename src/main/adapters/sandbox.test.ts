import { describe, expect, it } from 'vitest'
import {
  claudeSandboxOptions,
  codexSandboxMode,
  evaluateToolUse,
  isInsideRepo,
  isReadOnlyCommand
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
    expect(isReadOnlyCommand('git -c core.pager=cat status')).toBe(true)
    expect(isReadOnlyCommand('git commit -m x')).toBe(false)
    expect(isReadOnlyCommand('git checkout main')).toBe(false)
    expect(isReadOnlyCommand('git apply patch')).toBe(false)
    expect(isReadOnlyCommand('git push')).toBe(false)
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
    expect(claudeSandboxOptions('read_only').disallowedTools).toEqual(
      expect.arrayContaining(['Write', 'Edit', 'MultiEdit', 'NotebookEdit'])
    )
    expect(claudeSandboxOptions('workspace_write').disallowedTools).toEqual([])
    expect(claudeSandboxOptions('full_access').disallowedTools).toEqual([])
  })

  it('only asks to skip permissions at full_access', () => {
    expect(claudeSandboxOptions('read_only').allowDangerouslySkipPermissions).toBeUndefined()
    expect(claudeSandboxOptions('workspace_write').allowDangerouslySkipPermissions).toBeUndefined()
    expect(claudeSandboxOptions('full_access').allowDangerouslySkipPermissions).toBe(true)
  })
})
