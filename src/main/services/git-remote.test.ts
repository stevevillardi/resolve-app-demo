import { execFileSync } from 'child_process'
import { mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cloneRepo, originUrl, pushBranch } from './git'

/**
 * Real git again, in the style of git-worktree.test.ts — but against a **bare
 * repository on disk** standing in for GitHub, so the push half is exercised
 * end to end with no network and no credentials.
 *
 * This is the part of Phase 9 that no amount of REST mocking reaches: a pull
 * request is about commits, and the commits have to be uploaded by git before
 * the API has anything to open a PR against. The behaviours worth pinning are
 * the ones that would otherwise be discovered on a real repository — that a
 * push leaves no remote behind, and that a diverged branch is refused rather
 * than forced.
 */

let scratch: string
let repo: string
let remote: string

function run(args: string[], cwd = repo): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

function commit(file: string, contents: string, message: string): void {
  writeFileSync(join(repo, file), contents)
  run(['add', '-A'])
  run(['commit', '-m', message])
}

beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'pr-remote-')))
  remote = join(scratch, 'origin.git')
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remote])

  repo = join(scratch, 'my-app')
  execFileSync('git', ['init', '-q', '-b', 'main', repo])
  run(['config', 'user.email', 'test@example.com'])
  run(['config', 'user.name', 'Test'])
  commit('a.ts', 'export const a = 1\n', 'init')
})

afterEach(() => execFileSync('rm', ['-rf', scratch]))

function remoteSha(branch: string): string | null {
  const result = execFileSync(
    'git',
    ['--git-dir', remote, 'rev-parse', '--verify', '--quiet', branch],
    {
      encoding: 'utf8'
    }
  ).trim()
  return result || null
}

describe('pushBranch', () => {
  it('uploads the branch under the same name', async () => {
    run(['checkout', '-q', '-b', 'persona/buddy-1a2b'])
    commit('b.ts', 'export const b = 2\n', 'add b')

    await pushBranch(repo, 'persona/buddy-1a2b', remote)

    expect(remoteSha('persona/buddy-1a2b')).toBe(run(['rev-parse', 'HEAD']))
  })

  // The point of passing the URL instead of configuring it: the token this
  // carries in production must not outlive the command.
  it('leaves no remote and no upstream behind', async () => {
    run(['checkout', '-q', '-b', 'persona/buddy-1a2b'])
    commit('b.ts', 'export const b = 2\n', 'add b')

    await pushBranch(repo, 'persona/buddy-1a2b', remote)

    const config = readFileSync(join(repo, '.git', 'config'), 'utf8')
    expect(config).not.toContain('[remote')
    expect(config).not.toContain(remote)
    expect(await originUrl(repo)).toBeNull()
  })

  it('fast-forwards a branch that has already been pushed', async () => {
    run(['checkout', '-q', '-b', 'persona/buddy-1a2b'])
    commit('b.ts', 'export const b = 2\n', 'add b')
    await pushBranch(repo, 'persona/buddy-1a2b', remote)

    commit('c.ts', 'export const c = 3\n', 'add c')
    await pushBranch(repo, 'persona/buddy-1a2b', remote)

    expect(remoteSha('persona/buddy-1a2b')).toBe(run(['rev-parse', 'HEAD']))
  })

  it('refuses a diverged branch instead of forcing it, and moves nothing', async () => {
    run(['checkout', '-q', '-b', 'persona/buddy-1a2b'])
    commit('b.ts', 'export const b = 2\n', 'add b')
    await pushBranch(repo, 'persona/buddy-1a2b', remote)
    const pushed = remoteSha('persona/buddy-1a2b')

    // History rewritten under the remote's feet — an amend, a rebase, a reset.
    run(['reset', '-q', '--hard', 'HEAD~1'])
    commit('b.ts', 'export const b = 99\n', 'add b, differently')

    await expect(pushBranch(repo, 'persona/buddy-1a2b', remote)).rejects.toThrow(/diverged/i)
    expect(remoteSha('persona/buddy-1a2b')).toBe(pushed)
  })

  it('reports a missing branch without echoing git', async () => {
    await expect(pushBranch(repo, 'persona/never-existed', remote)).rejects.toThrow(
      'Pushing persona/never-existed failed.'
    )
  })
})

describe('cloneRepo', () => {
  it('records the remote it was given', async () => {
    // The no-token path: nothing to scrub, and the remote must survive intact.
    // The credential-bearing path needs a real https remote and is covered by
    // the LIVE_GITHUB check, which asserts the config is clean afterwards.
    const path = await cloneRepo(remote, scratch, 'fresh')

    expect(await originUrl(path)).toBe(remote)
    expect(readFileSync(join(path, '.git', 'config'), 'utf8')).not.toContain('x-access-token')
  })

  it('refuses to clone over something that already exists', async () => {
    await expect(cloneRepo(remote, scratch, 'my-app')).rejects.toThrow(/already exists/)
  })
})
