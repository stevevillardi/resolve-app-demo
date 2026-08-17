import { describe, expect, it } from 'vitest'
import { firstRenderable, languageForPath, statusLabel, unrenderableReason } from './diff-view'
import type { FileDiff } from '../../../shared/ipc-contract'

function file(overrides: Partial<FileDiff>): FileDiff {
  return {
    path: 'src/a.ts',
    status: 'modified',
    binary: false,
    truncated: false,
    live: false,
    oldText: 'a',
    newText: 'b',
    ...overrides
  }
}

describe('languageForPath', () => {
  it('maps the extensions that actually appear in bound repos', () => {
    expect(languageForPath('src/a.ts')).toBe('typescript')
    expect(languageForPath('src/App.tsx')).toBe('typescript')
    expect(languageForPath('lib/util.mjs')).toBe('javascript')
    expect(languageForPath('a/b/styles.scss')).toBe('scss')
    expect(languageForPath('README.md')).toBe('markdown')
    expect(languageForPath('scripts/build.sh')).toBe('shell')
    expect(languageForPath('Dockerfile')).toBe('dockerfile')
    expect(languageForPath('Makefile')).toBe('shell')
  })

  it('degrades to undefined rather than guessing', () => {
    expect(languageForPath('LICENSE')).toBeUndefined()
    expect(languageForPath('data.parquet')).toBeUndefined()
    // A dotfile's "extension" is its name; unhighlighted beats wrong.
    expect(languageForPath('.gitignore')).toBeUndefined()
  })
})

describe('statusLabel', () => {
  it('is one letter per status', () => {
    expect(statusLabel('added')).toBe('A')
    expect(statusLabel('deleted')).toBe('D')
    expect(statusLabel('renamed')).toBe('R')
    expect(statusLabel('modified')).toBe('M')
  })
})

describe('unrenderableReason', () => {
  it('renders ordinary pairs, including one-sided ones', () => {
    expect(unrenderableReason(file({}))).toBeNull()
    expect(unrenderableReason(file({ status: 'added', oldText: null }))).toBeNull()
    expect(unrenderableReason(file({ status: 'deleted', newText: null }))).toBeNull()
  })

  it('binary beats truncated — a huge binary is still binary', () => {
    expect(unrenderableReason(file({ binary: true, truncated: true }))).toMatch(/Binary/)
    expect(unrenderableReason(file({ truncated: true, oldText: null, newText: null }))).toMatch(
      /Too large/
    )
  })
})

describe('firstRenderable', () => {
  it('skips to the first pair that renders', () => {
    const files = [
      file({ path: 'blob.bin', binary: true }),
      file({ path: 'src/real.ts' }),
      file({ path: 'src/other.ts' })
    ]
    expect(firstRenderable(files)).toBe('src/real.ts')
  })

  it('falls back to the first file when nothing renders, and null when empty', () => {
    expect(firstRenderable([file({ path: 'blob.bin', binary: true })])).toBe('blob.bin')
    expect(firstRenderable([])).toBeNull()
  })
})
