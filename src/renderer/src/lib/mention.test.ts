import { describe, expect, it } from 'vitest'
import { mentionToken, parseMention, type MentionTarget } from './mention'

const TARGETS: MentionTarget[] = [
  { contactId: 'c-reviewer', name: 'Code Reviewer' },
  { contactId: 'c-code', name: 'Code' },
  { contactId: 'c-refactor', name: 'Refactor Buddy' }
]

describe('mentionToken', () => {
  it('ends with a space so the user can keep typing', () => {
    expect(mentionToken('Code Reviewer')).toBe('@Code Reviewer ')
  })
})

describe('parseMention', () => {
  it('routes to the named contact and strips the token', () => {
    expect(parseMention('@Code Reviewer take a look at auth.ts', TARGETS)).toEqual({
      contactId: 'c-reviewer',
      content: 'take a look at auth.ts'
    })
  })

  // "Code" is a prefix of "Code Reviewer". Shortest-first matching would route
  // every reviewer mention to the wrong persona.
  it('prefers the longest matching name', () => {
    expect(parseMention('@Code Reviewer hi', TARGETS)?.contactId).toBe('c-reviewer')
    expect(parseMention('@Code hi', TARGETS)?.contactId).toBe('c-code')
  })

  it('ignores case, since the picker writes the canonical name', () => {
    expect(parseMention('@code reviewer hi', TARGETS)?.contactId).toBe('c-reviewer')
  })

  it('tolerates leading whitespace', () => {
    expect(parseMention('   @Code Reviewer hi', TARGETS)?.contactId).toBe('c-reviewer')
  })

  it('addresses nobody when the mention is not at the start', () => {
    // A mention routes the whole message. Treating an inline reference as a
    // routing instruction would send "ask @Reviewer about this" to the
    // reviewer, which is not what was written.
    expect(parseMention('ask @Code Reviewer about this', TARGETS)).toBeNull()
  })

  it('addresses nobody when no name matches', () => {
    expect(parseMention('@Nobody hello', TARGETS)).toBeNull()
    expect(parseMention('just talking to myself', TARGETS)).toBeNull()
  })

  it('refuses a mention with nothing after it', () => {
    // Sending a bare "@Code Reviewer" would start a turn with an empty prompt,
    // which main rejects anyway (content.min(1)) — better to catch it here.
    expect(parseMention('@Code Reviewer', TARGETS)).toBeNull()
    expect(parseMention('@Code Reviewer    ', TARGETS)).toBeNull()
  })

  it('is empty-safe', () => {
    expect(parseMention('', TARGETS)).toBeNull()
    expect(parseMention('@Code Reviewer hi', [])).toBeNull()
  })
})
