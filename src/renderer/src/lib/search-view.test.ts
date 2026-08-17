import { describe, expect, it } from 'vitest'
import { parseSnippet } from './search-view'

describe('parseSnippet', () => {
  it('returns one plain segment for text with no markers', () => {
    expect(parseSnippet('nothing matched here')).toEqual([
      { text: 'nothing matched here', match: false }
    ])
  })

  it('splits marked tokens from their surroundings', () => {
    expect(parseSnippet('the \u0001token\u0002 cache')).toEqual([
      { text: 'the ', match: false },
      { text: 'token', match: true },
      { text: ' cache', match: false }
    ])
  })

  it('handles several matches and marker-adjacent boundaries', () => {
    expect(parseSnippet('\u0001token\u0002 \u0001cache\u0002')).toEqual([
      { text: 'token', match: true },
      { text: ' ', match: false },
      { text: 'cache', match: true }
    ])
  })

  it('treats an unterminated marker as matching to the end', () => {
    expect(parseSnippet('broken \u0001tail')).toEqual([
      { text: 'broken ', match: false },
      { text: 'tail', match: true }
    ])
  })

  it('is empty for an empty snippet', () => {
    expect(parseSnippet('')).toEqual([])
  })
})
