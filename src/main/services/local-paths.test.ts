import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { isKnownLocalPath } from './local-paths'

/**
 * The rule that keeps shell.openPath from becoming "open whatever the renderer
 * says". Tested through the pure half with explicit roots; knownRoots() is a
 * straight enumeration of rows and the worktree root.
 */

let scratch: string
let root: string

beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'pr-paths-')))
  root = join(scratch, 'repo')
  mkdirSync(join(root, 'src'), { recursive: true })
  writeFileSync(join(root, 'src', 'a.ts'), 'x')
})

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true })
})

describe('isKnownLocalPath', () => {
  it('allows the root itself and anything under it', () => {
    expect(isKnownLocalPath(root, [root])).toBe(true)
    expect(isKnownLocalPath(join(root, 'src', 'a.ts'), [root])).toBe(true)
  })

  it('refuses a path outside every root', () => {
    expect(isKnownLocalPath(scratch, [root])).toBe(false)
    expect(isKnownLocalPath('/etc/hosts', [root])).toBe(false)
  })

  it('refuses a sibling whose name merely starts with the root', () => {
    const sibling = `${root}-evil`
    mkdirSync(sibling, { recursive: true })
    expect(isKnownLocalPath(sibling, [root])).toBe(false)
  })

  it('refuses a symlink inside a root that points outside it', () => {
    const outside = join(scratch, 'outside.txt')
    writeFileSync(outside, 'secret')
    symlinkSync(outside, join(root, 'src', 'link.txt'))

    expect(isKnownLocalPath(join(root, 'src', 'link.txt'), [root])).toBe(false)
  })

  it('refuses a path that does not exist', () => {
    expect(isKnownLocalPath(join(root, 'missing.ts'), [root])).toBe(false)
  })
})
