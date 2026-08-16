import { describe, expect, it } from 'vitest'
import type { Usage } from '@openai/codex-sdk'
import {
  CACHED_TOKENS_ARE_SUBSET,
  CODEX_PRICES,
  LAST_VERIFIED,
  LONG_CONTEXT_THRESHOLD,
  computeCodexCost
} from './pricing'

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

  // Input stays under LONG_CONTEXT_THRESHOLD in this block: these cases are
  // about how the three components are priced, not about which tier applies.
  // Output size never affects the tier, so it stays at a round 1M.
  it('prices uncached input, cached input and output separately', () => {
    // gpt-5.5 short tier: $5.00 / $0.50 / $30.00 per 1M.
    const cost = computeCodexCost(
      'gpt-5.5',
      usage({ input_tokens: 200_000, cached_input_tokens: 0, output_tokens: 1_000_000 })
    )
    expect(cost).toBeCloseTo(0.2 * 5 + 30, 6)
  })

  it('treats cached tokens as a discount, not an extra charge', () => {
    const cost = computeCodexCost(
      'gpt-5.5',
      usage({ input_tokens: 200_000, cached_input_tokens: 200_000 })
    )
    // All input served from cache: 200k at $0.50/1M, not at $5.00/1M, and not
    // both rates added together.
    expect(cost).toBeCloseTo(0.1, 6)
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
      // Skipped rather than compared: `null` means "no published discount", and
      // `expect(null).toBeLessThan(5)` passes by coercing to 0 — which would
      // make this loop silently endorse the one value it exists to catch.
      if (price.cachedInput !== null) {
        expect(price.cachedInput, model).toBeLessThan(price.input)
      }
      expect(price.output, model).toBeGreaterThan(0)
    }
  })

  it('prices the long-context tier above the short one, where there is one', () => {
    for (const [model, price] of Object.entries(CODEX_PRICES)) {
      if (!price.longContext) continue
      expect(price.longContext.input, model).toBeGreaterThan(price.input)
      expect(price.longContext.output, model).toBeGreaterThan(price.output)
    }
  })

  it('includes the adapter default, or every turn reports a null cost', () => {
    expect(CODEX_PRICES['gpt-5.5']).toBeDefined()
  })
})

describe('the long-context tier', () => {
  it('bills a turn at the short rate right up to the threshold', () => {
    const cost = computeCodexCost(
      'gpt-5.5',
      usage({ input_tokens: LONG_CONTEXT_THRESHOLD, output_tokens: 1_000_000 })
    )
    // 272_000 input at $5/1M plus 1M output at $30/1M.
    expect(cost).toBeCloseTo(0.272 * 5 + 30, 6)
  })

  it('switches to the long rate one token past it', () => {
    const cost = computeCodexCost(
      'gpt-5.5',
      usage({ input_tokens: LONG_CONTEXT_THRESHOLD + 1, output_tokens: 1_000_000 })
    )
    // Same turn, long rates: $10/1M input and $45/1M output.
    expect(cost).toBeCloseTo(((LONG_CONTEXT_THRESHOLD + 1) * 10) / 1_000_000 + 45, 6)
  })

  it('raises output by half, not by double', () => {
    // Written from the transcribed figure rather than a multiplier: gpt-5.5
    // goes 30 → 45. A "tidy" refactor that doubles every long-context rate
    // passes the two tests above and fails this one.
    expect(CODEX_PRICES['gpt-5.5'].longContext?.output).toBe(45.0)
    expect(CODEX_PRICES['gpt-5.5'].longContext?.input).toBe(10.0)
  })

  it('still discounts cached tokens at the long rate', () => {
    const cost = computeCodexCost(
      'gpt-5.5',
      usage({ input_tokens: 1_000_000, cached_input_tokens: 1_000_000 })
    )
    // Wholly cached, over the threshold: $1.00/1M, not $10.00/1M.
    expect(cost).toBeCloseTo(1.0, 6)
  })

  it('leaves an untiered model on one rate however large the turn', () => {
    const big = computeCodexCost(
      'gpt-5.6-cyber',
      usage({ input_tokens: 1_000_000, output_tokens: 1_000_000 })
    )
    // $12.50/1M input + $75.00/1M output, with no tier to escalate to.
    expect(big).toBeCloseTo(87.5, 6)
    expect(CODEX_PRICES['gpt-5.6-cyber'].longContext).toBeUndefined()
  })

  it('charges the input rate for cached tokens when no discount is published', () => {
    // No shipped row sets `cachedInput: null` today, so this installs one to
    // exercise the path — otherwise the guard against a future `-pro` model
    // encoding its $0.00 cached rate as genuinely free would go untested, and
    // an untested guard is a comment.
    CODEX_PRICES['gpt-test-uncached'] = { input: 30.0, cachedInput: null, output: 180.0 }
    try {
      const cost = computeCodexCost(
        'gpt-test-uncached',
        usage({ input_tokens: 1_000_000, cached_input_tokens: 1_000_000 })
      )
      // Wholly cached, and billed as though none of it were: $30, not $0.
      expect(cost).toBeCloseTo(30.0, 6)
      expect(cost).not.toBe(0)
    } finally {
      delete CODEX_PRICES['gpt-test-uncached']
    }
  })
})
