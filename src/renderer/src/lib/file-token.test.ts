import { describe, expect, it } from 'vitest'
import { applyFileToken, parseFileToken, rankFiles, scoreFilePath } from './file-token'

describe('parseFileToken', () => {
  it('finds a token mid-sentence with the caret inside it', () => {
    const value = 'look at @src/au first'
    const caret = value.indexOf(' first')
    expect(parseFileToken(value, caret)).toEqual({ query: 'src/au', start: 8, end: 15 })
  })

  it('finds a token at index 0', () => {
    expect(parseFileToken('@auth', 5)).toEqual({ query: 'auth', start: 0, end: 5 })
  })

  it('is null when the caret is outside the token', () => {
    const value = '@auth and then'
    expect(parseFileToken(value, value.length)).toBeNull()
  })

  it('is null with the caret before the @', () => {
    expect(parseFileToken('@auth', 0)).toBeNull()
  })

  it('never treats an email as a token', () => {
    const value = 'mail steve@example.com now'
    const caret = value.indexOf(' now')
    expect(parseFileToken(value, caret)).toBeNull()
  })

  it('offers a bare @ as an empty query', () => {
    expect(parseFileToken('see @', 5)).toEqual({ query: '', start: 4, end: 5 })
  })

  // The group composer's index-0 @ is the mention, not a file.
  it('excludes tokens starting before minStart', () => {
    expect(parseFileToken('@Reviewer', 9, 1)).toBeNull()
    const value = '@Reviewer check @src'
    expect(parseFileToken(value, value.length, 1)).toEqual({ query: 'src', start: 16, end: 20 })
  })
})

describe('applyFileToken', () => {
  it('replaces the token with the bare path and a trailing space', () => {
    const value = 'look at @src/au first'
    const token = parseFileToken(value, value.indexOf(' first'))!

    expect(applyFileToken(value, token, 'src/auth.ts')).toEqual({
      value: 'look at src/auth.ts  first',
      caret: 'look at src/auth.ts '.length
    })
  })

  it('works at the end of the draft', () => {
    const token = parseFileToken('check @no', 9)!
    expect(applyFileToken('check @no', token, 'notes.md')).toEqual({
      value: 'check notes.md ',
      caret: 15
    })
  })
})

describe('scoreFilePath', () => {
  it('ranks basename-prefix above basename-contains above path tiers', () => {
    expect(scoreFilePath('src/auth.ts', 'auth')).toBe(100)
    expect(scoreFilePath('src/oauth.ts', 'auth')).toBe(70)
    expect(scoreFilePath('auth/index.ts', 'auth')).toBe(60)
    expect(scoreFilePath('src/preauthorize/x.ts', 'auth')).toBe(40)
    expect(scoreFilePath('src/index.ts', 'auth')).toBe(0)
  })

  it('matches case-insensitively and accepts an empty query', () => {
    expect(scoreFilePath('src/Auth.ts', 'auth')).toBe(100)
    expect(scoreFilePath('anything', '')).toBeGreaterThan(0)
  })
})

describe('rankFiles', () => {
  const files = ['src/index.ts', 'src/oauth.ts', 'src/auth.ts', 'auth/setup.ts', 'README.md']

  it('orders by tier and keeps git order on ties', () => {
    expect(rankFiles(files, 'auth')).toEqual(['src/auth.ts', 'src/oauth.ts', 'auth/setup.ts'])
  })

  it('keeps git order for an empty query', () => {
    expect(rankFiles(files, '', 3)).toEqual(['src/index.ts', 'src/oauth.ts', 'src/auth.ts'])
  })

  it('caps at the limit', () => {
    expect(rankFiles(files, '', 2)).toHaveLength(2)
  })

  it('drops non-matches entirely', () => {
    expect(rankFiles(files, 'zzz')).toEqual([])
  })
})
