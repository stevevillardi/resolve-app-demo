import { describe, expect, it } from 'vitest'
import { classifyErrorMessage } from './errors'

describe('classifyErrorMessage', () => {
  it('recognises rate limiting', () => {
    expect(classifyErrorMessage('Rate limit exceeded')).toBe('rate_limit')
    expect(classifyErrorMessage('HTTP 429 Too Many Requests')).toBe('rate_limit')
    expect(classifyErrorMessage('You have exceeded your quota')).toBe('rate_limit')
  })

  it('recognises auth failures', () => {
    // The exact string a stale Codex login produces, captured from a real run.
    expect(
      classifyErrorMessage(
        'Your access token could not be refreshed because your refresh token was already used. Please log out and sign in again.'
      )
    ).toBe('auth')
    expect(classifyErrorMessage('HTTP 401: unauthorized')).toBe('auth')
    expect(classifyErrorMessage('Not logged in')).toBe('auth')
  })

  it('recognises sandbox denials', () => {
    expect(classifyErrorMessage('the workspace is mounted read-only')).toBe('sandbox_denied')
    expect(classifyErrorMessage('operation not permitted by sandbox')).toBe('sandbox_denied')
    expect(classifyErrorMessage('permission denied')).toBe('sandbox_denied')
  })

  it('recognises network failures', () => {
    expect(classifyErrorMessage('ECONNRESET')).toBe('network')
    expect(classifyErrorMessage('getaddrinfo ENOTFOUND api.example.com')).toBe('network')
    expect(classifyErrorMessage('Request timed out')).toBe('network')
  })

  it('is case-insensitive', () => {
    expect(classifyErrorMessage('RATE LIMIT')).toBe('rate_limit')
  })

  it('falls back to unknown rather than guessing', () => {
    // Guessing would let the UI style an unrelated failure as, say, a rate
    // limit — which tells the user to wait and retry when that will not help.
    expect(classifyErrorMessage('Something went sideways')).toBe('unknown')
    expect(classifyErrorMessage('')).toBe('unknown')
  })
})
