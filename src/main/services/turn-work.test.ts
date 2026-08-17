import { execFileSync } from 'child_process'
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { captureWorkEnd, captureWorkStart } from './turn-work'

/**
 * Real git, like git-diff.test.ts — a work record is a statement about what
 * git saw, so the tests make git see it.
 */

let repo: string
let scratch: string

function run(args: string[]): string {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim()
}

function write(file: string, contents: string): void {
  mkdirSync(dirname(join(repo, file)), { recursive: true })
  writeFileSync(join(repo, file), contents)
}

function commitAllNow(message: string): void {
  run(['add', '-A'])
  run(['commit', '-q', '-m', message])
}

beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'pr-turnwork-')))
  repo = join(scratch, 'my-app')
  execFileSync('git', ['init', '-q', '-b', 'main', repo])
  run(['config', 'user.email', 'test@example.com'])
  run(['config', 'user.name', 'Test'])
  write('src/a.ts', 'original\n')
  commitAllNow('init')
})

afterEach(() => {
  execFileSync('rm', ['-rf', scratch])
})

describe('captureWorkStart', () => {
  it('is null for a directory with no .git, and spawns nothing for it', async () => {
    expect(await captureWorkStart(scratch)).toBeNull()
  })
})

describe('captureWorkEnd', () => {
  it('is null when the turn changed nothing', async () => {
    const start = await captureWorkStart(repo)
    expect(start).not.toBeNull()
    expect(await captureWorkEnd(repo, start!)).toBeNull()
  })

  it('records committed work as the head-to-head file list', async () => {
    const start = await captureWorkStart(repo)
    write('src/a.ts', 'edited\n')
    write('src/new.ts', 'added\n')
    commitAllNow('the turn commits')

    const work = await captureWorkEnd(repo, start!)
    expect(work).toMatchObject({ branch: 'main', headBefore: start!.headBefore })
    expect(work?.headAfter).not.toBe(start!.headBefore)
    expect(work?.committed.sort()).toEqual(['src/a.ts', 'src/new.ts'])
    expect(work?.dirty).toEqual([])
  })

  it('records uncommitted work, but only what this turn newly dirtied', async () => {
    // Dirty before the turn: not attributable to it.
    write('src/pre-existing.ts', 'somebody else was here\n')
    const start = await captureWorkStart(repo)

    write('src/touched.ts', 'the turn left this\n')
    const work = await captureWorkEnd(repo, start!)

    expect(work?.committed).toEqual([])
    expect(work?.dirty).toEqual(['src/touched.ts'])
  })

  it('records a turn that both commits and leaves new dirt', async () => {
    const start = await captureWorkStart(repo)
    write('src/a.ts', 'edited\n')
    commitAllNow('half the work')
    write('src/loose.ts', 'uncommitted half\n')

    const work = await captureWorkEnd(repo, start!)
    expect(work?.committed).toEqual(['src/a.ts'])
    expect(work?.dirty).toEqual(['src/loose.ts'])
  })
})
