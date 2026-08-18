import { describe, expect, it } from 'vitest'
import type { PersonaBackend, UsageEvent } from '@/types'
import {
  aggregateUsage,
  contextFill,
  contextTokens,
  type ContextTokens,
  formatCost,
  formatCostSummary,
  formatTokens,
  usageForContact,
  usageForContacts
} from './usage'

/**
 * Cost/token aggregation. The load-bearing case is the null cost.
 *
 * It no longer means "Codex": since Phase 5 both backends yield a dollar figure
 * — Claude's from its SDK, Codex's computed from src/main/adapters/pricing.ts.
 * A null is a model with no row in CODEX_PRICES, so the spend is real and the
 * amount is unknown. Two properties follow, and both are tested from that claim
 * rather than from the implementation: an unknown must never read as free, and
 * a total that excludes one must never read as complete.
 */

let nextId = 0
function event(partial: Partial<UsageEvent> = {}): UsageEvent {
  return {
    id: `u${nextId++}`,
    contactId: 'contact-1',
    timestamp: 1_700_000_000_000,
    source: 'message',
    inputTokens: 100,
    outputTokens: 50,
    costUsd: 0.01,
    ...partial
  }
}

describe('aggregateUsage', () => {
  it('returns a null cost and zero tokens for no events', () => {
    expect(aggregateUsage([])).toEqual({
      totalCostUsd: null,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      unpricedEvents: 0,
      pricedEvents: 0
    })
  })

  it('sums tokens and cost', () => {
    expect(aggregateUsage([event(), event()])).toMatchObject({
      totalCostUsd: 0.02,
      totalInputTokens: 200,
      totalOutputTokens: 100
    })
  })

  it('keeps the cost null when no event carries one', () => {
    // A Codex-only summary: real token spend, genuinely unknown dollar cost.
    const summary = aggregateUsage([event({ costUsd: null }), event({ costUsd: null })])
    expect(summary.totalCostUsd).toBeNull()
    expect(summary.totalInputTokens).toBe(200)
  })

  it('sums only the priced events in a mixed set', () => {
    // An unpriced turn must not be treated as 0 and folded into the total.
    const summary = aggregateUsage([event({ costUsd: 0.05 }), event({ costUsd: null })])
    expect(summary.totalCostUsd).toBe(0.05)
    expect(summary.totalInputTokens).toBe(200)
  })

  it('counts the events it left out of the total', () => {
    const summary = aggregateUsage([
      event({ costUsd: 0.05 }),
      event({ costUsd: null }),
      event({ costUsd: null })
    ])
    expect(summary.pricedEvents).toBe(1)
    expect(summary.unpricedEvents).toBe(2)
  })

  it('counts every event as unpriced when none carries a cost', () => {
    const summary = aggregateUsage([event({ costUsd: null }), event({ costUsd: null })])
    expect(summary.unpricedEvents).toBe(2)
    expect(summary.pricedEvents).toBe(0)
  })

  it('counts a real zero as priced', () => {
    // $0.00 is a figure we were given; null is one we never had.
    expect(aggregateUsage([event({ costUsd: 0 })]).pricedEvents).toBe(1)
    expect(aggregateUsage([event({ costUsd: 0 })]).unpricedEvents).toBe(0)
  })

  it('distinguishes a real zero cost from an unknown one', () => {
    expect(aggregateUsage([event({ costUsd: 0 })]).totalCostUsd).toBe(0)
    expect(aggregateUsage([event({ costUsd: null })]).totalCostUsd).toBeNull()
  })

  it('omits cached tokens entirely when no event reports them', () => {
    // Reporting 0 would assert "nothing was cached"; absent means "not known".
    expect(aggregateUsage([event()])).not.toHaveProperty('totalCachedInputTokens')
  })

  it('sums cached tokens when reported', () => {
    const summary = aggregateUsage([
      event({ cachedInputTokens: 20 }),
      event({ cachedInputTokens: 30 })
    ])
    expect(summary.totalCachedInputTokens).toBe(50)
  })

  it('reports cached tokens when only some events carry them', () => {
    const summary = aggregateUsage([event(), event({ cachedInputTokens: 40 })])
    expect(summary.totalCachedInputTokens).toBe(40)
  })

  it('keeps cached tokens separate from the input total', () => {
    // Blueprint §14 flags cached-vs-input double counting as an open question
    // for Phase 5/10 — aggregation must not pre-empt it by folding them.
    const summary = aggregateUsage([event({ inputTokens: 100, cachedInputTokens: 80 })])
    expect(summary.totalInputTokens).toBe(100)
    expect(summary.totalCachedInputTokens).toBe(80)
  })
})

describe('usageForContact', () => {
  it('includes only the named contact', () => {
    const summary = usageForContact(
      [event({ contactId: 'a' }), event({ contactId: 'b', inputTokens: 999 })],
      'a'
    )
    expect(summary.totalInputTokens).toBe(100)
  })

  it('returns an empty summary for an unknown contact', () => {
    expect(usageForContact([event({ contactId: 'a' })], 'nobody')).toEqual({
      totalCostUsd: null,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      unpricedEvents: 0,
      pricedEvents: 0
    })
  })
})

describe('usageForContacts', () => {
  it('includes every named contact', () => {
    const summary = usageForContacts(
      [event({ contactId: 'a' }), event({ contactId: 'b' }), event({ contactId: 'c' })],
      ['a', 'c']
    )
    expect(summary.totalInputTokens).toBe(200)
  })

  it('returns an empty summary for no contacts', () => {
    expect(usageForContacts([event()], []).totalInputTokens).toBe(0)
  })
})

describe('formatCost', () => {
  it.each([
    [null, '—'],
    [0, '$0.00'],
    [0.004, '<$0.01'],
    [0.01, '$0.01'],
    [1.5, '$1.50'],
    [1234.567, '$1234.57']
  ])('renders %s as "%s"', (input, expected) => {
    expect(formatCost(input)).toBe(expected)
  })

  it('renders unknown and free differently', () => {
    // The whole point: "—" means we don't know, "$0.00" means it was free.
    expect(formatCost(null)).not.toBe(formatCost(0))
  })
})

describe('formatCostSummary', () => {
  it('renders a complete total plainly', () => {
    expect(formatCostSummary(aggregateUsage([event({ costUsd: 12.34 })]))).toBe('$12.34')
  })

  it('marks a total that excludes an unpriced turn as partial', () => {
    // The regression guard for the defect this phase exists to fix: the same
    // set read through formatCost looks like a complete, confident figure.
    const summary = aggregateUsage([event({ costUsd: 12.34 }), event({ costUsd: null })])
    expect(formatCostSummary(summary)).toBe('$12.34+')
    expect(formatCost(summary.totalCostUsd)).toBe('$12.34')
  })

  it('keeps the partial marker on a sub-cent total', () => {
    const summary = aggregateUsage([event({ costUsd: 0.004 }), event({ costUsd: null })])
    expect(formatCostSummary(summary)).toBe('<$0.01+')
  })

  it('renders an all-unpriced set as unknown rather than as a partial zero', () => {
    // "—+" would be noise: there is no total for the + to qualify.
    expect(formatCostSummary(aggregateUsage([event({ costUsd: null })]))).toBe('—')
  })

  it('renders an empty set as unknown', () => {
    expect(formatCostSummary(aggregateUsage([]))).toBe('—')
  })

  it('still separates free from unknown', () => {
    expect(formatCostSummary(aggregateUsage([event({ costUsd: 0 })]))).toBe('$0.00')
    expect(formatCostSummary(aggregateUsage([event({ costUsd: null })]))).toBe('—')
  })
})

describe('contextTokens', () => {
  /**
   * Two figures, because they are two claims — and conflating them is what this
   * function used to do.
   *
   * `lastPromptTokens` is how full the window is now; `billedInputTokens` is
   * what the session has cost. On Claude they are near enough the same shape;
   * on Codex they diverge without bound, because every row is an increment and
   * the sum is a running total. Reporting the sum as "the prompt" — which is
   * what `promptTokens` did — overstates threefold by turn three and keeps
   * going.
   */
  const turn = (
    timestamp: number,
    inputTokens: number,
    extra: Partial<UsageEvent> = {}
  ): UsageEvent => event({ timestamp, inputTokens, sessionId: 'session-1', model: 'm', ...extra })

  it('takes the newest turn as the prompt on Claude', () => {
    const result = contextTokens([turn(1, 1000), turn(2, 5000)], 'session-1', 'claude')
    expect(result?.lastPromptTokens).toBe(5000)
    expect(result?.reading).toBe('last-turn')
    expect(result?.turns).toBe(2)
  })

  /**
   * The repo's own measurement, from the Phase 6/7 close-out: three one-word
   * Codex turns reported cumulative input 12122 → 25610 → 39114, so the stored
   * deltas are 12122 / 13488 / 13504.
   *
   * The bill is 39,114 — that really is what the session cost. The prompt is
   * about 13,504 — that really is what the last request held. A meter dividing
   * 39,114 by the window would read 3× high and climb for as long as the
   * conversation continued, which is the failure this split exists to prevent.
   */
  it('separates the running bill from the last prompt on Codex', () => {
    const result = contextTokens(
      [turn(1, 12_122), turn(2, 13_488), turn(3, 13_504)],
      'session-1',
      'codex'
    )
    expect(result?.billedInputTokens).toBe(39_114)
    expect(result?.lastPromptTokens).toBe(13_504)
    expect(result?.reading).toBe('session-sum')
  })

  it('adds every turn up for the bill on Claude too', () => {
    const result = contextTokens([turn(1, 1000), turn(2, 5000)], 'session-1', 'claude')
    expect(result?.billedInputTokens).toBe(6000)
  })

  it('finds the newest turn regardless of array order', () => {
    // usage.list returns newest-first, but nothing here should depend on it —
    // a caller that filtered or re-sorted would otherwise get the wrong turn
    // and a number that still looked reasonable.
    const ascending = contextTokens([turn(1, 1000), turn(2, 5000)], 'session-1', 'claude')
    const descending = contextTokens([turn(2, 5000), turn(1, 1000)], 'session-1', 'claude')
    expect(descending?.lastPromptTokens).toBe(ascending?.lastPromptTokens)
    expect(descending?.at).toBe(2)
  })

  it('counts cached and cache-write tokens as part of the prompt', () => {
    // All three were sent. Cached input is billed at a reduced rate, not
    // excluded from the context — a prompt of 100 fresh and 19,000 cached
    // tokens is a large prompt, and reporting 100 would say the opposite.
    const result = contextTokens(
      [turn(1, 100, { cachedInputTokens: 19_000, cacheWriteInputTokens: 400 })],
      'session-1',
      'claude'
    )
    expect(result?.lastPromptTokens).toBe(19_500)
  })

  it('treats missing cached figures as zero rather than NaN', () => {
    const result = contextTokens([turn(1, 100)], 'session-1', 'claude')
    expect(result?.lastPromptTokens).toBe(100)
  })

  it('ignores rows from a session that has ended', () => {
    // A prompt belongs to a session. Rows from a previous one describe a
    // conversation the backend has already forgotten.
    const result = contextTokens(
      [turn(1, 9000, { sessionId: 'session-0' }), turn(2, 100)],
      'session-1',
      'claude'
    )
    expect(result?.lastPromptTokens).toBe(100)
    expect(result?.billedInputTokens).toBe(100)
    expect(result?.turns).toBe(1)
  })

  it('is null before there is a session', () => {
    // Not zero: zero would claim an empty prompt, and there is no prompt yet.
    expect(contextTokens([turn(1, 100)], null, 'claude')).toBeNull()
  })

  it('is null when the session has no recorded turns', () => {
    expect(contextTokens([], 'session-1', 'claude')).toBeNull()
  })

  it('reports the model that served the newest turn', () => {
    // Per event, not off the persona: a persona's model can change at any time,
    // and the context was built by whatever actually ran.
    const result = contextTokens(
      [turn(1, 100, { model: 'old' }), turn(2, 200, { model: 'new' })],
      'session-1',
      'claude'
    )
    expect(result?.model).toBe('new')
  })
})

describe('contextFill', () => {
  /**
   * The reversal of the no-percentage stance, tested at the point it could go
   * wrong: a fraction is shown where there is a real denominator, and *nothing*
   * is shown where there is not. The second half is what makes the first half
   * honest, so it gets as many cases as the arithmetic does.
   */
  const session = (
    inputTokens: number,
    model?: string,
    backend: PersonaBackend = 'claude'
  ): ContextTokens =>
    contextTokens(
      [event({ timestamp: 1, inputTokens, sessionId: 'session-1', ...(model ? { model } : {}) })],
      'session-1',
      backend
    ) as ContextTokens

  it('divides the last prompt by the model’s window', () => {
    // 50k of a Claude model's 200k.
    expect(contextFill(session(50_000, 'claude-opus-5'))?.fraction).toBeCloseTo(0.25)
    // 100k of a GPT-5 400k.
    expect(contextFill(session(100_000, 'gpt-5.5'))?.fraction).toBeCloseTo(0.25)
  })

  // The whole basis of the reversal: where there is no table row there is no
  // percentage, and the meter falls back to what the app showed before.
  it('is null for a model with no published window', () => {
    expect(contextFill(session(50_000, 'gpt-9-imaginary'))).toBeNull()
    // No model recorded at all — an older row, or a backend that did not say.
    expect(contextFill(session(50_000))).toBeNull()
  })

  it('carries where the denominator came from', () => {
    expect(contextFill(session(1000, 'claude-haiku-4-5'))?.windowSource).toBe('published')
    expect(contextFill(session(1000, 'claude-opus-5'))?.windowSource).toBe('inferred')
  })

  // A stale table, or a model served with a bigger window than the one
  // published, would otherwise render "130% full" — which reads as a bug rather
  // than as the honest "at least full" it actually means.
  it('clamps at full rather than reporting over 100%', () => {
    expect(contextFill(session(500_000, 'claude-opus-5'))?.fraction).toBe(1)
  })

  // The numerator is the last prompt, never the running bill. On Codex those
  // diverge without bound, and using the bill would make a long cheap
  // conversation look full when it is not.
  it('measures the last request, not everything the session has been billed', () => {
    const tokens = contextTokens(
      [
        event({ timestamp: 1, inputTokens: 100_000, sessionId: 's', model: 'claude-opus-5' }),
        event({ timestamp: 2, inputTokens: 20_000, sessionId: 's', model: 'claude-opus-5' })
      ],
      's',
      'codex'
    ) as ContextTokens

    expect(tokens.billedInputTokens).toBe(120_000)
    expect(contextFill(tokens)?.fraction).toBeCloseTo(0.1)
  })
})

describe('formatTokens', () => {
  it.each([
    [0, '0'],
    [999, '999'],
    [1000, '1.0k'],
    [1500, '1.5k'],
    [999_999, '1000.0k'],
    [1_000_000, '1.0M'],
    [2_500_000, '2.5M']
  ])('renders %i as "%s"', (input, expected) => {
    expect(formatTokens(input)).toBe(expected)
  })
})
