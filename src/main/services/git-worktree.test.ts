import { execFileSync } from 'child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  branchExists,
  changedFiles,
  deleteBranch,
  gitWritePathsFor,
  headSha,
  isDirty,
  mergeBranch,
  mergePreview,
  worktreeAdd,
  worktreeList,
  worktreePrune,
  worktreeRemove
} from './git'

/**
 * These run real git against a real repository in a temp directory.
 *
 * That is new ground here — every other test in this suite is either pure or
 * runs against `:memory:` SQLite, and git.test.ts covers only the two pure
 * helpers. It is the right trade for this file: the whole point of these
 * functions is what *git* does in response, and a mocked `spawn` would only
 * prove that the argument arrays match a guess about git's behaviour. Several of
 * these behaviours are genuinely surprising — a failed `add` leaving its branch
 * behind, a branch outliving a `remove` — and a mock would have encoded the
 * guess rather than the fact.
 *
 * git is already a hard requirement of the app, so it is available wherever
 * these tests run.
 */

let repo: string
let scratch: string

function run(args: string[], cwd = repo): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

function commit(file: string, contents: string, message: string, cwd = repo): void {
  mkdirSync(dirname(join(cwd, file)), { recursive: true })
  writeFileSync(join(cwd, file), contents)
  run(['add', '-A'], cwd)
  run(['commit', '-m', message], cwd)
}

beforeEach(() => {
  // Resolved, because git reports real paths and macOS makes /var a symlink to
  // /private/var — the same reason isInsideRepo() calls realpathSync.
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'pr-worktree-')))
  repo = join(scratch, 'my-app')
  execFileSync('git', ['init', '-q', '-b', 'main', repo])
  run(['config', 'user.email', 'test@example.com'])
  run(['config', 'user.name', 'Test'])
  commit('src/a.ts', 'export const a = 1\n', 'init')
})

afterEach(() => {
  // Worktrees hold registrations in the repo, and the repo is inside scratch —
  // removing the tree is enough, nothing outside it was touched.
  execFileSync('rm', ['-rf', scratch])
})

describe('worktreeAdd', () => {
  it('creates the directory with the repo checked out into it', async () => {
    const path = join(scratch, 'wt', 'buddy')
    await worktreeAdd(repo, path, 'persona/buddy')

    expect(existsSync(join(path, 'src/a.ts'))).toBe(true)
    expect(run(['rev-parse', '--abbrev-ref', 'HEAD'], path)).toBe('persona/buddy')
  })

  it('creates missing intermediate directories', async () => {
    const path = join(scratch, 'a', 'b', 'c', 'buddy')
    await worktreeAdd(repo, path, 'persona/buddy')

    expect(existsSync(path)).toBe(true)
  })

  // The state after a user deletes a worktree directory by hand: prune reclaims
  // the registration, but the branch and its commits survive. Recreating with
  // `-b` would refuse, and refusing would strand work nobody has merged.
  it('reuses an existing branch rather than refusing', async () => {
    const path = join(scratch, 'wt', 'buddy')
    await worktreeAdd(repo, path, 'persona/buddy')
    commit('src/b.ts', 'export const b = 2\n', 'work', path)
    const done = run(['rev-parse', 'HEAD'], path)

    execFileSync('rm', ['-rf', path])
    await worktreeAdd(repo, path, 'persona/buddy')

    expect(run(['rev-parse', 'HEAD'], path)).toBe(done)
    expect(existsSync(join(path, 'src/b.ts'))).toBe(true)
  })

  it('refuses to check one branch out into two worktrees', async () => {
    await worktreeAdd(repo, join(scratch, 'wt', 'one'), 'persona/buddy')

    await expect(worktreeAdd(repo, join(scratch, 'wt', 'two'), 'persona/buddy')).rejects.toThrow(
      /already used by worktree/i
    )
  })

  // A failed `git worktree add -b` still creates the branch. Left behind, it
  // would send the *next* attempt down the reuse path above, against a branch
  // pointing at whatever was current when the failure happened.
  it('leaves no branch behind when it fails', async () => {
    const occupied = join(scratch, 'occupied')
    execFileSync('mkdir', ['-p', occupied])
    writeFileSync(join(occupied, 'file'), 'in the way')

    await expect(worktreeAdd(repo, occupied, 'persona/doomed')).rejects.toThrow()
    expect(await branchExists(repo, 'persona/doomed')).toBe(false)
  })

  it('surfaces git’s own reason, which the user has to read to act on', async () => {
    const occupied = join(scratch, 'occupied')
    execFileSync('mkdir', ['-p', occupied])
    writeFileSync(join(occupied, 'file'), 'in the way')

    await expect(worktreeAdd(repo, occupied, 'persona/doomed')).rejects.toThrow(/already exists/i)
  })
})

describe('worktreeList', () => {
  it('reports the main tree and each worktree with its branch', async () => {
    await worktreeAdd(repo, join(scratch, 'wt', 'buddy'), 'persona/buddy')

    const entries = await worktreeList(repo)

    expect(entries).toHaveLength(2)
    expect(entries[0].branch).toBe('main')
    expect(entries[1].branch).toBe('persona/buddy')
    expect(entries[1].head).toMatch(/^[0-9a-f]{40}$/)
  })

  it('marks a hand-deleted worktree prunable rather than dropping it', async () => {
    const path = join(scratch, 'wt', 'buddy')
    await worktreeAdd(repo, path, 'persona/buddy')
    execFileSync('rm', ['-rf', path])

    const entry = (await worktreeList(repo)).find((candidate) => candidate.path === path)
    expect(entry?.prunable).toBe(true)
  })
})

describe('worktreePrune', () => {
  it('reclaims a hand-deleted worktree but keeps its branch', async () => {
    const path = join(scratch, 'wt', 'buddy')
    await worktreeAdd(repo, path, 'persona/buddy')
    execFileSync('rm', ['-rf', path])

    await worktreePrune(repo)

    expect(await worktreeList(repo)).toHaveLength(1)
    // The work survives the directory. This is why deleting a worktree by hand
    // is recoverable rather than destructive.
    expect(await branchExists(repo, 'persona/buddy')).toBe(true)
  })
})

describe('worktreeRemove', () => {
  it('removes a clean worktree', async () => {
    const path = join(scratch, 'wt', 'buddy')
    await worktreeAdd(repo, path, 'persona/buddy')

    await worktreeRemove(repo, path)

    expect(existsSync(path)).toBe(false)
  })

  it('refuses to discard uncommitted work without being told to', async () => {
    const path = join(scratch, 'wt', 'buddy')
    await worktreeAdd(repo, path, 'persona/buddy')
    writeFileSync(join(path, 'scratch.ts'), 'unsaved\n')

    await expect(worktreeRemove(repo, path)).rejects.toThrow(/modified or untracked/i)
    expect(existsSync(path)).toBe(true)
  })

  it('discards it when forced', async () => {
    const path = join(scratch, 'wt', 'buddy')
    await worktreeAdd(repo, path, 'persona/buddy')
    writeFileSync(join(path, 'scratch.ts'), 'unsaved\n')

    await worktreeRemove(repo, path, true)

    expect(existsSync(path)).toBe(false)
  })

  // Deleting a Contact should not silently destroy commits nobody merged.
  it('leaves the branch behind', async () => {
    const path = join(scratch, 'wt', 'buddy')
    await worktreeAdd(repo, path, 'persona/buddy')
    commit('src/b.ts', 'export const b = 2\n', 'work', path)

    await worktreeRemove(repo, path, true)

    expect(await branchExists(repo, 'persona/buddy')).toBe(true)
  })

  it('treats an already-gone worktree as success, not failure', async () => {
    const path = join(scratch, 'wt', 'buddy')
    await worktreeAdd(repo, path, 'persona/buddy')
    execFileSync('rm', ['-rf', path])

    await expect(worktreeRemove(repo, path)).resolves.toBeUndefined()
    expect(await worktreeList(repo)).toHaveLength(1)
  })
})

describe('gitWritePathsFor', () => {
  // The finding this whole phase turns on: a worktree's .git is a file pointing
  // into the main repo, so git writes land outside the working directory. A
  // sandbox fenced to the worktree fails at `git add`.
  it('points outside the worktree, because that is where git writes', async () => {
    const path = join(scratch, 'wt', 'buddy')
    await worktreeAdd(repo, path, 'persona/buddy')

    const paths = await gitWritePathsFor(path)

    expect(paths.every((candidate) => !candidate.startsWith(path))).toBe(true)
    expect(paths.some((candidate) => candidate.includes('/worktrees/'))).toBe(true)
    expect(paths).toEqual(
      expect.arrayContaining([
        join(repo, '.git', 'objects'),
        join(repo, '.git', 'refs'),
        join(repo, '.git', 'logs')
      ])
    )
  })

  // Excluded on purpose: a writable hooks directory is a sandbox escape, since a
  // hook written during a turn runs unsandboxed on the next git command.
  it('grants neither hooks nor config', async () => {
    const path = join(scratch, 'wt', 'buddy')
    await worktreeAdd(repo, path, 'persona/buddy')

    const paths = await gitWritePathsFor(path)

    expect(paths).not.toContain(join(repo, '.git'))
    expect(paths.some((candidate) => candidate.endsWith('/hooks'))).toBe(false)
    expect(paths.some((candidate) => candidate.endsWith('/config'))).toBe(false)
  })

  // git dedupes the per-worktree directory from the path's basename, so it
  // cannot be derived — two worktrees named `work` become `work` and `work1`.
  it('reads the real directory name rather than deriving it', async () => {
    const first = join(scratch, 'a', 'work')
    const second = join(scratch, 'b', 'work')
    await worktreeAdd(repo, first, 'persona/one')
    await worktreeAdd(repo, second, 'persona/two')

    const [ownFirst] = await gitWritePathsFor(first)
    const [ownSecond] = await gitWritePathsFor(second)

    expect(ownFirst).not.toBe(ownSecond)
    expect(readFileSync(join(second, '.git'), 'utf8')).toContain(ownSecond)
  })

  it('grants nothing extra in the main tree, where repoPath already covers it', async () => {
    expect(await gitWritePathsFor(repo)).toEqual([])
  })
})

describe('mergePreview', () => {
  async function divergingBranches(): Promise<void> {
    run(['checkout', '-q', '-b', 'persona/buddy'])
    commit('src/a.ts', 'buddy edit\n', 'buddy edits a')
    run(['checkout', '-q', 'main'])
  }

  it('reports a clean merge', async () => {
    run(['checkout', '-q', '-b', 'persona/buddy'])
    commit('src/b.ts', 'export const b = 2\n', 'buddy adds b')
    run(['checkout', '-q', 'main'])

    expect(await mergePreview(repo, 'main', 'persona/buddy')).toEqual({
      clean: true,
      conflicts: []
    })
  })

  it('names the conflicted files', async () => {
    await divergingBranches()
    commit('src/a.ts', 'main edit\n', 'main edits a')

    const preview = await mergePreview(repo, 'main', 'persona/buddy')

    expect(preview.clean).toBe(false)
    expect(preview.conflicts).toEqual(['src/a.ts'])
  })

  // The reason merge-tree was chosen over `merge --no-commit --no-ff`: that one
  // is a dry run that isn't, leaving the target tree conflicted on failure. This
  // is the assertion that keeps anyone from "simplifying" it back.
  it('touches neither HEAD nor the working tree', async () => {
    await divergingBranches()
    commit('src/a.ts', 'main edit\n', 'main edits a')
    const before = run(['rev-parse', 'HEAD'])

    await mergePreview(repo, 'main', 'persona/buddy')

    expect(run(['rev-parse', 'HEAD'])).toBe(before)
    expect(run(['status', '--porcelain'])).toBe('')
    expect(readFileSync(join(repo, 'src/a.ts'), 'utf8')).toBe('main edit\n')
  })
})

describe('mergeBranch', () => {
  it('merges into the working path it is given, and no other', async () => {
    const path = join(scratch, 'wt', 'buddy')
    await worktreeAdd(repo, path, 'persona/buddy')
    commit('src/b.ts', 'export const b = 2\n', 'buddy adds b', path)

    const reviewer = join(scratch, 'wt', 'reviewer')
    await worktreeAdd(repo, reviewer, 'persona/reviewer')

    await mergeBranch(reviewer, 'persona/buddy')

    expect(existsSync(join(reviewer, 'src/b.ts'))).toBe(true)
    // The user's own checkout is untouched — merging for one persona must not
    // reach into anybody else's tree.
    expect(existsSync(join(repo, 'src/b.ts'))).toBe(false)
  })

  it('leaves nothing half-applied when it conflicts', async () => {
    run(['checkout', '-q', '-b', 'persona/buddy'])
    commit('src/a.ts', 'buddy edit\n', 'buddy edits a')
    run(['checkout', '-q', 'main'])
    commit('src/a.ts', 'main edit\n', 'main edits a')

    await expect(mergeBranch(repo, 'persona/buddy')).rejects.toThrow()

    expect(run(['status', '--porcelain'])).toBe('')
    expect(readFileSync(join(repo, 'src/a.ts'), 'utf8')).toBe('main edit\n')
  })
})

describe('changedFiles', () => {
  it('reports what the branch did, not how it differs from a moved base', async () => {
    run(['checkout', '-q', '-b', 'persona/buddy'])
    commit('src/b.ts', 'export const b = 2\n', 'buddy adds b')
    run(['checkout', '-q', 'main'])
    // main moves on. With two dots this would also list src/c.ts, which the
    // branch had nothing to do with.
    commit('src/c.ts', 'export const c = 3\n', 'main adds c')

    expect(await changedFiles(repo, 'main', 'persona/buddy')).toEqual(['src/b.ts'])
  })
})

describe('headSha and isDirty', () => {
  it('reads the head of a working path', async () => {
    expect(await headSha(repo)).toBe(run(['rev-parse', 'HEAD']))
  })

  it('sees untracked files as dirty, not just modified ones', async () => {
    expect(await isDirty(repo)).toBe(false)
    writeFileSync(join(repo, 'untracked.ts'), 'new\n')
    expect(await isDirty(repo)).toBe(true)
  })
})

describe('deleteBranch', () => {
  it('refuses to drop unmerged work unless forced', async () => {
    run(['checkout', '-q', '-b', 'persona/buddy'])
    commit('src/b.ts', 'export const b = 2\n', 'buddy adds b')
    run(['checkout', '-q', 'main'])

    await expect(deleteBranch(repo, 'persona/buddy')).rejects.toThrow(/not fully merged/i)
    await deleteBranch(repo, 'persona/buddy', true)

    expect(await branchExists(repo, 'persona/buddy')).toBe(false)
  })
})
