/**
 * Turns a search snippet into renderable segments (review §B4).
 *
 * The search service wraps matched tokens in \u0001/\u0002 control
 * characters — markers that cannot occur in real message text, unlike
 * anything printable in a code-adjacent corpus. The constants are duplicated
 * from src/main/services/search.ts deliberately: importing them would pull a
 * main-process module (and its database import) into the renderer bundle,
 * and search.test.ts pins the values on the producing side.
 *
 * Pure and in lib/ for the usual reason: the renderer Vitest project matches
 * `*.test.ts` only.
 */

const SNIPPET_OPEN = '\u0001'
const SNIPPET_CLOSE = '\u0002'

export interface SnippetSegment {
  text: string
  match: boolean
}

export function parseSnippet(snippet: string): SnippetSegment[] {
  const segments: SnippetSegment[] = []
  let rest = snippet

  while (rest.length > 0) {
    const open = rest.indexOf(SNIPPET_OPEN)
    if (open === -1) {
      segments.push({ text: rest, match: false })
      break
    }
    if (open > 0) segments.push({ text: rest.slice(0, open), match: false })

    const close = rest.indexOf(SNIPPET_CLOSE, open + 1)
    // No closing marker is malformed input; claiming the tail as the match
    // renders something sensible instead of leaking a control character.
    if (close === -1) {
      segments.push({ text: rest.slice(open + 1), match: true })
      break
    }
    segments.push({ text: rest.slice(open + 1, close), match: true })
    rest = rest.slice(close + 1)
  }

  return segments
}
