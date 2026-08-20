import type { FileDiff } from '../../../shared/ipc-contract'

/**
 * The pure half of the diff viewer — in lib/ because logic in a .tsx is
 * untestable by construction here (the renderer test project matches
 * *.test.ts only).
 */

/**
 * Monaco language id for a path, or undefined for plain text.
 *
 * Extension-based and deliberately small: these are the languages that
 * actually appear in repositories this app binds, and an unmapped extension
 * degrades to an unhighlighted diff rather than a wrong one.
 */
export function languageForPath(path: string): string | undefined {
  const name = path.split('/').at(-1) ?? path
  if (/^dockerfile$/i.test(name)) return 'dockerfile'
  if (/^makefile$/i.test(name)) return 'shell'

  const extension = name.includes('.') ? name.split('.').at(-1)?.toLowerCase() : undefined
  if (!extension) return undefined

  const map: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    mts: 'typescript',
    cts: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    mjs: 'javascript',
    cjs: 'javascript',
    json: 'json',
    jsonc: 'json',
    css: 'css',
    scss: 'scss',
    less: 'less',
    html: 'html',
    htm: 'html',
    xml: 'xml',
    svg: 'xml',
    md: 'markdown',
    markdown: 'markdown',
    py: 'python',
    rb: 'ruby',
    go: 'go',
    rs: 'rust',
    java: 'java',
    kt: 'kotlin',
    swift: 'swift',
    c: 'cpp',
    h: 'cpp',
    cc: 'cpp',
    cpp: 'cpp',
    hpp: 'cpp',
    cs: 'csharp',
    php: 'php',
    sh: 'shell',
    bash: 'shell',
    zsh: 'shell',
    sql: 'sql',
    yml: 'yaml',
    yaml: 'yaml',
    graphql: 'graphql',
    lua: 'lua',
    r: 'r',
    scala: 'scala',
    dart: 'dart'
  }
  return map[extension]
}

/** One-word label for the file list; the glyph colouring keys off status. */
export function statusLabel(status: FileDiff['status']): string {
  switch (status) {
    case 'added':
      return 'A'
    case 'deleted':
      return 'D'
    case 'renamed':
      return 'R'
    default:
      return 'M'
  }
}

/**
 * Why a pair has no rendered text, or null when it does.
 *
 * The order matters: binary beats truncated (a huge binary is still binary),
 * and both beat the added/deleted shapes, which *do* render — one side empty
 * is what those diffs look like.
 */
export function unrenderableReason(file: FileDiff): string | null {
  if (file.binary) return 'Binary file — no text to diff.'
  if (file.truncated) return 'Too large to render here. Open it in your editor instead.'
  return null
}

/**
 * Why git listed a file the diff editor will render with no marks at all, or
 * null when the two sides genuinely differ.
 *
 * `git diff --name-status` reports `M` for a **mode** change — 644 to 755 —
 * whose two blobs are byte-identical, and `R100` for a rename that edited
 * nothing. Both arrive here as a normal pair, and the pane then renders the
 * whole file with every line unchanged, which reads as the viewer being broken
 * rather than as the file not having changed.
 *
 * Line endings are normalised before comparing because Monaco's models are:
 * `createModel` stores one EOL for the document, so a CRLF-to-LF commit hands
 * us two different strings and still renders as two identical files.
 *
 * One-sided pairs return null. An empty side is what an add or a delete looks
 * like, not an absence of change.
 */
export function noVisibleChangeNote(file: FileDiff): string | null {
  if (file.oldText === null || file.newText === null) return null
  if (normalizeEol(file.oldText) !== normalizeEol(file.newText)) return null

  return file.status === 'renamed'
    ? 'Moved. Its contents did not change.'
    : 'git lists this file as changed, but both sides hold the same lines — the change is to its mode or its line endings.'
}

function normalizeEol(text: string): string {
  return text.replace(/\r\n/g, '\n')
}

/** The first file worth selecting: the first one that renders. */
export function firstRenderable(files: FileDiff[]): string | null {
  return (files.find((file) => !unrenderableReason(file)) ?? files[0])?.path ?? null
}
