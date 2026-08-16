/**
 * Turning a Group composer draft into a routed mention (blueprint §8).
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
