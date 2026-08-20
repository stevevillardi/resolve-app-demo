/**
 * Turning a Group composer draft into a routed mention.
 *
 * Lives in lib/ rather than inside GroupThreadView on purpose: the renderer
 * Vitest project matches `src/renderer/**\/*.test.ts` and there is no
 * @testing-library/react, so logic worth testing has to sit outside a `.tsx`
 * file. Same reasoning as lib/stream.ts and lib/command-palette.ts.
 */

export interface MentionTarget {
  contactId: string
  /** What the picker inserted, e.g. "Code Reviewer". */
  name: string
}

export interface ParsedMention {
  contactId: string
  /** The draft with the `@Name` prefix removed. */
  content: string
}

/** What MentionPicker inserts into the draft when a Contact is chosen. */
export function mentionToken(name: string): string {
  return `@${name} `
}

/**
 * The partial name being typed at the head of the draft — what a typeahead
 * filters by — or null when no suggestions belong on screen.
 *
 * Null in three cases: the draft is not a mention at all, the mention is
 * already settled (a resolved name followed by content — parseMention says
 * so), or the token has run onto another line, at which point the user is
 * plainly writing a message rather than an address.
 */
export function mentionQuery(draft: string, targets: MentionTarget[]): string | null {
  const trimmed = draft.trimStart()
  if (!trimmed.startsWith('@')) return null
  if (parseMention(draft, targets)) return null

  const token = trimmed.slice(1)
  if (token.includes('\n')) return null
  return token
}

/**
 * Targets matching a typeahead query, prefix matches ahead of substring ones.
 *
 * Everything matches the empty query — a bare `@` should offer the whole
 * roster, which is also what the picker button shows.
 */
export function matchMentionTargets(query: string, targets: MentionTarget[]): MentionTarget[] {
  const q = query.trim().toLowerCase()
  return targets
    .filter((target) => target.name.toLowerCase().includes(q))
    .sort((a, b) => {
      const aStarts = a.name.toLowerCase().startsWith(q) ? 0 : 1
      const bStarts = b.name.toLowerCase().startsWith(q) ? 0 : 1
      return aStarts - bStarts || a.name.localeCompare(b.name)
    })
}

/**
 * Finds which Contact a draft is addressed to, and strips the token.
 *
 * Matches only at the start of the draft. A mention is a routing instruction
 * for the whole message, not an inline reference — "ask @Reviewer about this"
 * addresses nobody, and silently routing it to the reviewer would be a worse
 * outcome than declining to send.
 *
 * Longest name first, so "Code Reviewer" is not shadowed by a contact called
 * "Code". Returns null when the draft names nobody, which is what the composer
 * uses to refuse the send.
 */
export function parseMention(draft: string, targets: MentionTarget[]): ParsedMention | null {
  const trimmed = draft.trimStart()

  const match = [...targets]
    .sort((a, b) => b.name.length - a.name.length)
    .find((target) => trimmed.toLowerCase().startsWith(`@${target.name.toLowerCase()}`))

  if (!match) return null

  const content = trimmed.slice(`@${match.name}`.length).trim()
  if (!content) return null

  return { contactId: match.contactId, content }
}
