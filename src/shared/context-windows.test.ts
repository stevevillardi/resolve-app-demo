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
    expect(contextWindowFor('claude-opus-5')?.tokens).toBe(1_000_000)
    expect(contextWindowFor('gpt-5.5')?.tokens).toBe(400_000)
  })

  /**
   * The defect this table shipped with, pinned as a table rather than as prose.
   *
   * Claude runs two tiers and this app's picker straddles them: Opus 4.6 and
   * Sonnet 4.6 forward hold 1M, while Haiku 4.5 — like Sonnet 4.5 and
   * everything older — holds 200k. The first version of this file recorded all
   * eight at 200k, so the meter divided by a fifth of the real window and
   * called a half-full prompt full.
   *
   * No unit test can check a transcribed number against a vendor's page, and
   * this one does not pretend to. What it pins is that the two tiers are
   * *distinguished*: an edit that flattens the table back to a single figure —
   * exactly the shape of the original mistake — fails here rather than shipping
   * as a confident wrong percentage.
   */
  it.each([
    ['claude-fable-5', 1_000_000],
    ['claude-opus-5', 1_000_000],
    ['claude-opus-4-8', 1_000_000],
    ['claude-opus-4-7', 1_000_000],
    ['claude-opus-4-6', 1_000_000],
    ['claude-sonnet-5', 1_000_000],
    ['claude-sonnet-4-6', 1_000_000],
    ['claude-haiku-4-5', 200_000]
  ])('puts %s on the %d-token tier', (model, tokens) => {
    expect(contextWindowFor(model)?.tokens).toBe(tokens)
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
    // Both kinds still exist in the table, and the meter's tooltip says which.
    // Note what `source` does *not* mean, which is what the 200k defect taught:
    // it records how a number was obtained, not whether it is still true. Every
    // Claude row below was `published` or `inferred` and all eight were stale
    // together. LAST_VERIFIED is the field that carries currency.
    expect(contextWindowFor('claude-opus-5')?.source).toBe('published')
    expect(contextWindowFor('gpt-5.5')?.source).toBe('inferred')
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
