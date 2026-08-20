/**
 * The composer's @file token: parsing, ranking, insertion.
 *
 * Unlike the slash picker, which is a whole-value prefix at index 0, a file
 * token can sit anywhere in a sentence — "look at @src/auth.ts first" — so
 * everything here is caret-anchored: the token is the whitespace-delimited
 * word the caret is inside, and it only counts when that word begins with
 * `@`. An email like a@b never triggers, because its token starts with `a`.
 *
 * Pure and in lib/ for the usual reason: the renderer Vitest project matches
 * `*.test.ts` only, and picker rules that only fail under a cursor are
 * exactly the ones that need tests.
 */

export interface FileToken {
  /** What was typed after the @, used to filter the file list. */
  query: string
  /** Index of the @ itself. */
  start: number
  /** One past the token's last character. */
  end: number
}

const isSpace = (char: string): boolean => /\s/.test(char)

/**
 * The @token under the caret, or null.
 *
 * `minStart` excludes tokens that begin before that index — the group
 * composer passes 1, because its index-0 `@` is the mention, not a file.
 */
export function parseFileToken(value: string, caret: number, minStart = 0): FileToken | null {
  if (caret < 0 || caret > value.length) return null

  let start = caret
  while (start > 0 && !isSpace(value[start - 1])) start -= 1

  let end = caret
  while (end < value.length && !isSpace(value[end])) end += 1

  if (start >= end) return null
  if (value[start] !== '@') return null
  if (start < minStart) return null
  // The caret sitting *before* the @ is not typing inside the token.
  if (caret <= start) return null

  return { query: value.slice(start + 1, end), start, end }
}

/** Replaces the token with the bare path, returning the new caret position. */
export function applyFileToken(
  value: string,
  token: FileToken,
  path: string
): { value: string; caret: number } {
  const inserted = `${path} `
  return {
    value: value.slice(0, token.start) + inserted + value.slice(token.end),
    caret: token.start + inserted.length
  }
}

/**
 * How well a path answers the query. People type the *suffix* of a path —
 * the basename — so basename tiers outrank whole-path ones, which is the
 * opposite of scoreCommand's label/detail split and why this isn't it.
 */
export function scoreFilePath(path: string, query: string): number {
  const needle = query.toLowerCase()
  if (needle === '') return 1

  const haystack = path.toLowerCase()
  const basename = haystack.slice(haystack.lastIndexOf('/') + 1)

  if (basename.startsWith(needle)) return 100
  if (basename.includes(needle)) return 70
  if (haystack.split('/').some((segment) => segment.startsWith(needle))) return 60
  if (haystack.includes(needle)) return 40
  return 0
}

/** Top matches, ties keeping git's order (which is the repo's own order). */
export function rankFiles(files: string[], query: string, limit = 8): string[] {
  return files
    .map((path, index) => ({ path, index, score: scoreFilePath(path, query) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map((entry) => entry.path)
}
