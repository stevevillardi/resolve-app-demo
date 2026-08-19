import { execFileSync } from 'child_process'
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  binaryPaths,
  commitAll,
  diffNameOnlyBetween,
  diffNameStatus,
  fileAtRev,
  isAncestor,
  mergeBase
} from './git'

/**
 * Real git, real repo — same reasoning as git-worktree.test.ts: these helpers
 * exist entirely for what git does in response, and the behaviours the diff
 * viewer leans on (the `R100` rename format, `numstat`'s `-` markers, `show`'s
 * exit code for a missing side) were verified live before being written down
 * here. A mocked spawn would test the guess, not the fact.
 */

let repo: string
let scratch: string

function run(args: string[], cwd = repo): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

function write(file: string, contents: string, cwd = repo): void {
  mkdirSync(dirname(join(cwd, file)), { recursive: true })
  writeFileSync(join(cwd, file), contents)
}

function commit(message: string, cwd = repo): void {
  run(['add', '-A'], cwd)
  run(['commit', '-q', '-m', message], cwd)
}

beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'pr-diff-')))
  repo = join(scratch, 'my-app')
  execFileSync('git', ['init', '-q', '-b', 'main', repo])
  run(['config', 'user.email', 'test@example.com'])
  run(['config', 'user.name', 'Test'])
  write('src/a.ts', 'line1\nline2\nline3\n')
  write('src/gone.ts', 'keep\n')
  write('src/old.ts', 'stable content that survives the rename\n')
  writeFileSync(join(repo, 'blob.bin'), Buffer.from([0, 1, 2, 255]))
  commit('init')
})

afterEach(() => {
  execFileSync('rm', ['-rf', scratch])
})

/** A branch carrying one of each kind of change. */
function makeChangeBranch(): { base: string } {
  const base = run(['rev-parse', 'HEAD'])
  run(['checkout', '-q', '-b', 'persona/test'])
  write('src/a.ts', 'line1\nCHANGED\nline3\n')
  run(['rm', '-q', 'src/gone.ts'])
  run(['mv', 'src/old.ts', 'src/new.ts'])
  write('src/added.ts', 'brand new\n')
  writeFileSync(join(repo, 'blob.bin'), Buffer.from([0, 9, 9, 255]))
  commit('changes')
  run(['checkout', '-q', 'main'])
  return { base }
}

describe('diffNameStatus', () => {
  it('classifies adds, deletes, edits, and renames', async () => {
    const { base } = makeChangeBranch()
    const entries = await diffNameStatus(repo, base, 'persona/test')

    expect(entries).toContainEqual({ path: 'src/added.ts', status: 'added' })
    expect(entries).toContainEqual({ path: 'src/gone.ts', status: 'deleted' })
    expect(entries).toContainEqual({ path: 'src/a.ts', status: 'modified' })
    expect(entries).toContainEqual({
      path: 'src/new.ts',
      oldPath: 'src/old.ts',
      status: 'renamed'
    })
  })

  /**
   * The evidence behind `noVisibleChangeNote` in the renderer. git reports `M`
   * for a mode-only change, so a file with byte-identical blobs reaches the
   * diff pane as an ordinary modified pair — which Monaco then renders with
   * every line unchanged. Proven against real git rather than assumed, because
   * the note the viewer prints is a claim about git's behaviour.
   */
  it('calls a mode-only change modified, with both sides identical', async () => {
    const base = run(['rev-parse', 'HEAD'])
    run(['checkout', '-q', '-b', 'persona/chmod'])
    // On disk rather than `update-index --chmod`, which moves the index alone
    // and leaves the checkout looking dirty against its own commit.
    chmodSync(join(repo, 'src/a.ts'), 0o755)
    commit('make it executable')
    run(['checkout', '-q', 'main'])

    const entries = await diffNameStatus(repo, base, 'persona/chmod')
    expect(entries).toEqual([{ path: 'src/a.ts', status: 'modified' }])

    const before = await fileAtRev(repo, base, 'src/a.ts', 1_000)
    const after = await fileAtRev(repo, 'persona/chmod', 'src/a.ts', 1_000)
    expect(after.text).toBe(before.text)
  })

  it('throws a legible error for an unknown revision', async () => {
    await expect(diffNameStatus(repo, 'no-such-rev', 'HEAD')).rejects.toThrow(/Could not diff/)
  })
})

describe('binaryPaths', () => {
  it('marks the binary file and nothing else', async () => {
    const { base } = makeChangeBranch()
    const binaries = await binaryPaths(repo, base, 'persona/test')
    expect(binaries).toEqual(new Set(['blob.bin']))
  })

  it('marks both sides of a moved-and-modified binary', async () => {
    // Probed live: content this small defeats rename detection, so git reports
    // a delete plus an add — and numstat marks each side `-` on its own line.
    // Both paths land in the set, which renders correctly: each entry is shown
    // as binary rather than as text.
    const base = run(['rev-parse', 'HEAD'])
    run(['checkout', '-q', '-b', 'persona/binmove'])
    run(['mv', 'blob.bin', 'moved.bin'])
    writeFileSync(join(repo, 'moved.bin'), Buffer.from([0, 7, 7, 7, 255]))
    commit('move binary')
    run(['checkout', '-q', 'main'])

    const binaries = await binaryPaths(repo, base, 'persona/binmove')
    expect(binaries.has('moved.bin')).toBe(true)
    expect(binaries.has('src/a.ts')).toBe(false)
  })
})

describe('fileAtRev', () => {
  it('reads both sides of an edit', async () => {
    const { base } = makeChangeBranch()
    expect((await fileAtRev(repo, base, 'src/a.ts', 100_000)).text).toContain('line2')
    expect((await fileAtRev(repo, 'persona/test', 'src/a.ts', 100_000)).text).toContain('CHANGED')
  })

  it('returns null text for the side a file does not exist on', async () => {
    const { base } = makeChangeBranch()
    // Added: nothing at base. Deleted: nothing on the branch.
    expect(await fileAtRev(repo, base, 'src/added.ts', 100_000)).toEqual({
      text: null,
      truncated: false
    })
    expect(await fileAtRev(repo, 'persona/test', 'src/gone.ts', 100_000)).toEqual({
      text: null,
      truncated: false
    })
  })

  it('withholds an over-cap file rather than clipping it', async () => {
    const { text, truncated } = await fileAtRev(repo, 'HEAD', 'src/a.ts', 4)
    expect(text).toBeNull()
    expect(truncated).toBe(true)
  })
})

describe('isAncestor', () => {
  it('flips from false to true when the branch is merged', async () => {
    makeChangeBranch()
    expect(await isAncestor(repo, 'persona/test', 'HEAD')).toBe(false)
    run(['merge', '-q', '--no-ff', '--no-edit', 'persona/test'])
    expect(await isAncestor(repo, 'persona/test', 'HEAD')).toBe(true)
  })

  it('is false rather than throwing for an unknown ref', async () => {
    expect(await isAncestor(repo, 'no-such-branch', 'HEAD')).toBe(false)
  })
})

describe('mergeBase / diffNameOnlyBetween', () => {
  it('finds the divergence point even after main moves on', async () => {
    const { base } = makeChangeBranch()
    write('src/mainline.ts', 'main moved\n')
    commit('main moves on')

    expect(await mergeBase(repo, 'HEAD', 'persona/test')).toBe(base)
    // Two-dot between the branch ends: main's own movement is visible, which is
    // exactly why branch diffs go through mergeBase first.
    const files = await diffNameOnlyBetween(repo, base, 'persona/test')
    expect(files).toContain('src/added.ts')
    expect(files).not.toContain('src/mainline.ts')
  })

  it('mergeBase is null for an unknown ref', async () => {
    expect(await mergeBase(repo, 'HEAD', 'no-such-branch')).toBeNull()
  })
})

describe('commitAll', () => {
  it('commits everything with the persona as author and the user as committer', async () => {
    write('src/work.ts', 'persona wrote this\n')
    write('src/untracked.ts', 'this too\n')

    const sha = await commitAll(repo, 'feat: persona work', {
      name: 'Refactor Buddy',
      email: 'refactor-buddy@personas.switchboard.local'
    })

    expect(run(['rev-parse', 'HEAD'])).toBe(sha)
    expect(run(['status', '--porcelain'])).toBe('')
    expect(run(['log', '-1', '--format=%an <%ae>'])).toBe(
      'Refactor Buddy <refactor-buddy@personas.switchboard.local>'
    )
    expect(run(['log', '-1', '--format=%cn'])).toBe('Test')
  })

  it('fails legibly when there is nothing to commit', async () => {
    await expect(
      commitAll(repo, 'empty', { name: 'X', email: 'x@personas.switchboard.local' })
    ).rejects.toThrow(/Could not commit/)
  })
})
