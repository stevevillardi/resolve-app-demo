import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getAppPath: () => '/Applications/Switchboard.app/Contents/Resources/app.asar' }
}))

const { firstSpawnable, isInsideAsar, resolveVendored, unpackedSearchRoots } =
  await import('./vendored-binaries')

/**
 * The rule that keeps a packaged build able to start a session.
 *
 * Worth executing rather than reading, because the production failure is
 * invisible to every check that would normally catch it: `require.resolve`
 * returns a path inside `app.asar`, Electron's patched `fs` reports that path
 * as present, and only the `spawn` syscall — which has no asar awareness —
 * disagrees, with `ENOTDIR`. A resolver that trusts `existsSync` is therefore
 * wrong in exactly the case it cannot observe.
 */

describe('isInsideAsar', () => {
  it('rejects a path inside the archive', () => {
    expect(isInsideAsar('/App/Contents/Resources/app.asar/node_modules/@x/y/bin')).toBe(true)
  })

  /**
   * The distinction the whole thing turns on. `app.asar.unpacked/` is a real
   * directory on disk, and it is where the spawnable copy lives — a check that
   * matched on the substring `.asar` would reject the only correct answer.
   */
  it('accepts the unpacked directory beside it', () => {
    expect(isInsideAsar('/App/Contents/Resources/app.asar.unpacked/node_modules/@x/y/bin')).toBe(
      false
    )
  })

  it('accepts an ordinary dev path', () => {
    expect(isInsideAsar('/Users/dev/project/node_modules/@x/y/bin')).toBe(false)
  })

  it('handles Windows separators', () => {
    expect(isInsideAsar('C:\\App\\resources\\app.asar\\node_modules\\@x\\y.exe')).toBe(true)
    expect(isInsideAsar('C:\\App\\resources\\app.asar.unpacked\\node_modules\\@x\\y.exe')).toBe(
      false
    )
  })
})

describe('firstSpawnable', () => {
  /**
   * The case that produced `spawn ENOTDIR` in a real build: a filesystem that
   * says yes to a path that cannot be executed. The guard has to run *before*
   * the exists check, so a lying answer can never become a return value.
   */
  it('never returns an in-asar path, even when the filesystem claims it exists', () => {
    const everythingExists = (): boolean => true
    expect(firstSpawnable(['/App/Resources/app.asar/node_modules/x/bin'], everythingExists)).toBe(
      null
    )
  })

  it('skips the archive and takes the unpacked copy', () => {
    const found = firstSpawnable(
      [
        '/App/Resources/app.asar/node_modules/x/bin',
        '/App/Resources/app.asar.unpacked/node_modules/x/bin'
      ],
      () => true
    )
    expect(found).toBe('/App/Resources/app.asar.unpacked/node_modules/x/bin')
  })

  it('returns the first candidate that is actually there', () => {
    const present = new Set(['/b/bin'])
    expect(firstSpawnable(['/a/bin', '/b/bin', '/c/bin'], (p) => present.has(p))).toBe('/b/bin')
  })

  it('is null when nothing exists', () => {
    expect(firstSpawnable(['/a/bin', '/b/bin'], () => false)).toBeNull()
  })

  it('is null for no candidates at all', () => {
    expect(firstSpawnable([], () => true)).toBeNull()
  })
})

describe('unpackedSearchRoots', () => {
  /**
   * `app.getAppPath()` is `…/app.asar` in a packaged build, so one of these
   * roots is always poisoned. It is kept — it is the correct answer in dev —
   * and made harmless by the filter rather than by being ordered last and
   * hoped about, which is what the codex resolver was doing.
   */
  it('includes the unpacked sibling of the app path', () => {
    expect(unpackedSearchRoots()).toContain(
      '/Applications/Switchboard.app/Contents/Resources/app.asar.unpacked/node_modules'
    )
  })

  it('still offers the raw app path, which resolveVendored then refuses', () => {
    const roots = unpackedSearchRoots()
    expect(roots.some((root) => isInsideAsar(`${root}/pkg/bin`))).toBe(true)
    expect(resolveVendored('pkg/bin', (p) => p.includes('app.asar/'))).toBeNull()
  })
})

describe('resolveVendored', () => {
  it('finds a binary under the unpacked root', () => {
    const found = resolveVendored('@openai/codex-darwin-arm64/vendor/x/bin/codex', (p) =>
      p.includes('app.asar.unpacked')
    )
    expect(found).toContain('app.asar.unpacked')
    expect(found).toContain('@openai/codex-darwin-arm64/vendor/x/bin/codex')
  })

  it('is null when the package is not installed anywhere', () => {
    expect(resolveVendored('@openai/codex-linux-x64/vendor/x/bin/codex', () => false)).toBeNull()
  })
})
