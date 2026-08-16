import { describe, expect, it } from 'vitest'
import type { Usage } from '@openai/codex-sdk'
import { CACHED_TOKENS_ARE_SUBSET, CODEX_PRICES, LAST_VERIFIED, computeCodexCost } from './pricing'

function usage(overrides: Partial<Usage> = {}): Usage {
  return {
    input_tokens: 0,
    cached_input_tokens: 0,
    cache_write_input_tokens: 0,
    output_tokens: 0,
    reasoning_output_tokens: 0,
    ...overrides
  }
}

describe('computeCodexCost', () => {
  it('returns null for a model that is not in the table', () => {
    // Null rather than 0 on purpose: $0.00 next to a real turn reads as "this
    // was free" rather than "we do not know what this cost".
    expect(computeCodexCost('gpt-9-imaginary', usage({ input_tokens: 1000 }))).toBeNull()
  })

  it('prices uncached input, cached input and output separately', () => {
    // gpt-5.5: $5.00 / $0.50 / $30.00 per 1M.
    const cost = computeCodexCost(
      'gpt-5.5',
      usage({ input_tokens: 1_000_000, cached_input_tokens: 0, output_tokens: 1_000_000 })
    )
    expect(cost).toBeCloseTo(35, 6)
  })

  it('treats cached tokens as a discount, not an extra charge', () => {
    const cost = computeCodexCost(
      'gpt-5.5',
      usage({ input_tokens: 1_000_000, cached_input_tokens: 1_000_000 })
    )
    // All input served from cache: $0.50, not $5.50 and not $5.00.
    expect(cost).toBeCloseTo(0.5, 6)
    expect(CACHED_TOKENS_ARE_SUBSET).toBe(true)
  })

  it('reproduces a real observed turn to the cent', () => {
    // Captured from a live gpt-5.5 read_only run on 2026-08-16; the probe
    // reported 0.035124 and this is the arithmetic that has to keep matching.
    const cost = computeCodexCost(
      'gpt-5.5',
      usage({ input_tokens: 24696, cached_input_tokens: 21248, output_tokens: 242 })
    )
    expect(cost).toBeCloseTo(0.035124, 9)
  })

  it('never charges for cache writes', () => {
    const withWrites = computeCodexCost(
      'gpt-5.5',
      usage({ input_tokens: 1000, cache_write_input_tokens: 500_000 })
    )
    const without = computeCodexCost('gpt-5.5', usage({ input_tokens: 1000 }))
    expect(withWrites).toBe(without)
  })

  it('never adds reasoning tokens on top of output tokens', () => {
    const withReasoning = computeCodexCost(
      'gpt-5.5',
      usage({ output_tokens: 1000, reasoning_output_tokens: 900 })
    )
    const without = computeCodexCost('gpt-5.5', usage({ output_tokens: 1000 }))
    expect(withReasoning).toBe(without)
  })

  it('does not go negative if cached somehow exceeds input', () => {
    const cost = computeCodexCost(
      'gpt-5.5',
      usage({ input_tokens: 100, cached_input_tokens: 5000 })
    )
    expect(cost).toBeGreaterThanOrEqual(0)
  })

  it('is zero for a turn that used nothing', () => {
    expect(computeCodexCost('gpt-5.5', usage())).toBe(0)
  })
})

describe('the price table', () => {
  it('carries a last-verified date, since these figures go stale', () => {
    expect(LAST_VERIFIED).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('prices cached input below uncached input for every model', () => {
    for (const [model, price] of Object.entries(CODEX_PRICES)) {
      expect(price.cachedInput, model).toBeLessThan(price.input)
      expect(price.output, model).toBeGreaterThan(0)
    }
  })

  it('includes the adapter default, or every turn reports a null cost', () => {
    expect(CODEX_PRICES['gpt-5.5']).toBeDefined()
  })
})
