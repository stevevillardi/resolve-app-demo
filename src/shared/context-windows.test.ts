import { describe, expect, it } from 'vitest'
import { CONTEXT_WINDOWS_LAST_VERIFIED, contextWindowFor } from './context-windows'

/**
 * The claim this table makes is narrow on purpose: it knows some models and
 * says so about the rest. Most of what is worth testing is the "says so" half —
 * a wrong denominator is worse than no denominator, because it turns a missing
 * feature into a confident false measurement.
 */

describe('contextWindowFor', () => {
  it('resolves a model the picker offers', () => {
    expect(contextWindowFor('claude-opus-5')?.tokens).toBe(200_000)
    expect(contextWindowFor('gpt-5.5')?.tokens).toBe(400_000)
  })

  // Measured, not assumed: the captured SDK fixture in claude.test.ts reports
  // modelUsage keyed by the dated id while models.ts offers the alias, so a
  // usage_events row holds the dated form and the table holds the alias.
  it('resolves the dated id Claude actually bills under', () => {
    expect(contextWindowFor('claude-haiku-4-5-20251001')?.tokens).toBe(200_000)
  })

  it('says nothing about a model it does not know', () => {
    expect(contextWindowFor('gpt-6-turbo')).toBeNull()
    expect(contextWindowFor('claude-opus-9')).toBeNull()
  })

  it('says nothing when there is no model at all', () => {
    expect(contextWindowFor(null)).toBeNull()
    expect(contextWindowFor(undefined)).toBeNull()
    expect(contextWindowFor('')).toBeNull()
  })

  // The rule that keeps a near miss from silently borrowing another model's
  // window. Only an exact id or an exact id plus a date resolves — a prefix
  // match would answer confidently and wrongly, and nothing on screen would
  // show it had happened.
  it('does not resolve a prefix or a suffix to a neighbour', () => {
    expect(contextWindowFor('claude-opus')).toBeNull()
    expect(contextWindowFor('gpt-5.5-preview')).toBeNull()
    expect(contextWindowFor('my-claude-opus-5')).toBeNull()
  })

  it('marks where each number came from', () => {
    // Both kinds exist in the table, and the meter's tooltip says which — a
    // reader deciding whether to act on "92% full" should know if the
    // denominator was read off a page or taken from the family.
    expect(contextWindowFor('claude-haiku-4-5')?.source).toBe('published')
    expect(contextWindowFor('claude-opus-5')?.source).toBe('inferred')
  })
})

describe('CONTEXT_WINDOWS_LAST_VERIFIED', () => {
  // Same convention as pricing.ts: the date is shown to the user, so it has to
  // be a date.
  it('is a parseable ISO date', () => {
    expect(CONTEXT_WINDOWS_LAST_VERIFIED).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(Number.isNaN(Date.parse(CONTEXT_WINDOWS_LAST_VERIFIED))).toBe(false)
  })
})
