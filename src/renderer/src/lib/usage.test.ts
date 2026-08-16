import { describe, expect, it } from 'vitest'
import type { UsageEvent } from '@/types'
import {
  aggregateUsage,
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
