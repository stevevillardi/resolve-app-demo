import { describe, expect, it } from 'vitest'
import {
  firstRenderable,
  languageForPath,
  noVisibleChangeNote,
  statusLabel,
  unrenderableReason
} from './diff-view'
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

describe('noVisibleChangeNote', () => {
  const MODE_NOTE =
    'git lists this file as changed, but both sides hold the same lines — the change is to its mode or its line endings.'

  it('names the mode change behind a pair git calls modified and the editor cannot mark', () => {
    expect(noVisibleChangeNote(file({ oldText: 'same\n', newText: 'same\n' }))).toBe(MODE_NOTE)
  })

  it('sees through line endings, because the editor’s models normalise them', () => {
    // Two different strings that Monaco renders as two identical files: its
    // models hold one EOL for the document, so the CRLF never reaches the diff.
    expect(noVisibleChangeNote(file({ oldText: 'a\r\nb\r\n', newText: 'a\nb\n' }))).toBe(MODE_NOTE)
  })

  it('says moved, not changed, for a rename that edited nothing', () => {
    expect(
      noVisibleChangeNote(
        file({ status: 'renamed', oldPath: 'src/old.ts', oldText: 'x', newText: 'x' })
      )
    ).toBe('Moved. Its contents did not change.')
  })

  it('is silent for a real edit, whitespace included', () => {
    expect(noVisibleChangeNote(file({ oldText: 'a', newText: 'b' }))).toBeNull()
    // The case Monaco's ignoreTrimWhitespace default used to swallow. It is a
    // change, it renders as one now, and this note must not claim otherwise.
    expect(noVisibleChangeNote(file({ oldText: 'a \n', newText: 'a\n' }))).toBeNull()
  })

  it('is silent for one-sided pairs — an empty side is what an add or delete is', () => {
    expect(noVisibleChangeNote(file({ status: 'added', oldText: null, newText: '' }))).toBeNull()
    expect(noVisibleChangeNote(file({ status: 'deleted', oldText: '', newText: null }))).toBeNull()
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
