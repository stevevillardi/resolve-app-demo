import type { FileDiff } from '../../../shared/ipc-contract'

/**
 * The pure half of the diff viewer (Phase 19) — in lib/ because logic in a
 * .tsx is untestable by construction here (the renderer test project matches
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

/** The first file worth selecting: the first one that renders. */
export function firstRenderable(files: FileDiff[]): string | null {
  return (files.find((file) => !unrenderableReason(file)) ?? files[0])?.path ?? null
}
