import { describe, expect, it } from 'vitest'
import {
  matchMentionTargets,
  mentionQuery,
  mentionToken,
  parseMention,
  type MentionTarget
} from './mention'

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

/**
 * Typing `@` offers a completion rather than leaving the icon-button picker as
 * the only affordance. These pin the typeahead's decision half: when
 * suggestions belong on screen and in what order.
 */
describe('mentionQuery', () => {
  it('is the partial name while the user is still addressing', () => {
    expect(mentionQuery('@', TARGETS)).toBe('')
    expect(mentionQuery('@Co', TARGETS)).toBe('Co')
    expect(mentionQuery('  @Refa', TARGETS)).toBe('Refa')
  })

  it('closes once the mention is settled with content behind it', () => {
    expect(mentionQuery('@Code Reviewer look at auth.ts', TARGETS)).toBeNull()
  })

  it('is null for a draft that is not a mention', () => {
    expect(mentionQuery('just talking', TARGETS)).toBeNull()
    expect(mentionQuery('', TARGETS)).toBeNull()
  })

  it('closes when the token runs onto another line', () => {
    expect(mentionQuery('@Code\nreview this', TARGETS)).toBeNull()
  })
})

describe('matchMentionTargets', () => {
  it('offers the whole roster on a bare @', () => {
    expect(matchMentionTargets('', TARGETS).map((t) => t.name)).toEqual([
      'Code',
      'Code Reviewer',
      'Refactor Buddy'
    ])
  })

  it('ranks prefix matches ahead of substring ones', () => {
    const targets: MentionTarget[] = [
      { contactId: 'a', name: 'Release Manager' },
      { contactId: 'b', name: 'Reviewer' }
    ]
    expect(matchMentionTargets('Re', targets).map((t) => t.name)).toEqual([
      'Release Manager',
      'Reviewer'
    ])
    // 'view' appears inside Reviewer only.
    expect(matchMentionTargets('view', targets).map((t) => t.name)).toEqual(['Reviewer'])
  })

  it('matches case-insensitively and drops non-matches', () => {
    expect(matchMentionTargets('refactor', TARGETS).map((t) => t.name)).toEqual(['Refactor Buddy'])
    expect(matchMentionTargets('zzz', TARGETS)).toEqual([])
  })
})
