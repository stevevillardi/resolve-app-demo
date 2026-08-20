import { describe, expect, it } from 'vitest'
import { byContactId, combineUsage, summariesFor } from './usage-summary'
import type { ContactUsageSummary, UsageSummary } from './domain'

/**
 * Composing rollups (Phase 25 §B1).
 *
 * `usage.summaries` returns one figure per Contact, and every other scope the
 * app shows is some set of Contacts added up — a repo group, a persona, "all
 * personas". Two of `aggregateUsage`'s rules only bite once you add totals
 * together, and both are about refusing to invent a fact, so both are asserted
 * from the claim rather than from what the code happens to do.
 */

function summary(over: Partial<UsageSummary> = {}): UsageSummary {
  return {
    totalCostUsd: 1,
    totalInputTokens: 100,
    totalOutputTokens: 10,
    unpricedEvents: 0,
    pricedEvents: 1,
    ...over
  }
}

describe('combineUsage', () => {
  it('adds the priced totals and the event counts', () => {
    const total = combineUsage([summary({ totalCostUsd: 1.5 }), summary({ totalCostUsd: 2.25 })])

    expect(total.totalCostUsd).toBeCloseTo(3.75, 10)
    expect(total.totalInputTokens).toBe(200)
    expect(total.totalOutputTokens).toBe(20)
    expect(total.pricedEvents).toBe(2)
  })

  it('keeps a partly-priced scope partial rather than confident', () => {
    // The case that produces "$1.00+" on screen. A combine that let the null
    // side contribute a silent 0 would render "$1.00" — a figure, about a scope
    // whose real cost is unknown and larger.
    const total = combineUsage([
      summary({ totalCostUsd: 1, pricedEvents: 1, unpricedEvents: 0 }),
      summary({ totalCostUsd: null, pricedEvents: 0, unpricedEvents: 3 })
    ])

    expect(total.totalCostUsd).toBe(1)
    expect(total.unpricedEvents).toBe(3)
    expect(total.pricedEvents).toBe(1)
  })

  it('stays unknown when nothing in the scope was priced', () => {
    const total = combineUsage([
      summary({ totalCostUsd: null, pricedEvents: 0, unpricedEvents: 2 }),
      summary({ totalCostUsd: null, pricedEvents: 0, unpricedEvents: 1 })
    ])

    // Null all the way out, so `formatCostSummary` prints "—". Zero here would
    // print "$0.00" and claim three turns were free.
    expect(total.totalCostUsd).toBeNull()
    expect(total.unpricedEvents).toBe(3)
  })

  it('reports cached tokens when only some members recorded any', () => {
    const total = combineUsage([summary({ totalCachedInputTokens: 400 }), summary()])

    // One caching backend and one silent one: report what is known rather than
    // discarding it because the other side said nothing.
    expect(total.totalCachedInputTokens).toBe(400)
  })

  it('omits cached tokens entirely when nobody recorded any', () => {
    const total = combineUsage([summary(), summary()])

    expect('totalCachedInputTokens' in total).toBe(false)
  })

  it('rolls an empty scope up to zero, not to unknown', () => {
    // Deliberately different from `summariesFor`, which answers undefined. The
    // arithmetic identity for "no turns" is zero; deciding whether to render a
    // badge at all is the caller's question, not this function's.
    expect(combineUsage([])).toEqual({
      totalCostUsd: null,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      unpricedEvents: 0,
      pricedEvents: 0
    })
  })
})

describe('summariesFor', () => {
  const rows: ContactUsageSummary[] = [
    { contactId: 'a', ...summary({ totalCostUsd: 1 }) },
    { contactId: 'b', ...summary({ totalCostUsd: 2 }) }
  ]
  const index = byContactId(rows)

  it('sums only the contacts asked for', () => {
    expect(summariesFor(index, ['a'])?.totalCostUsd).toBe(1)
    expect(summariesFor(index, ['a', 'b'])?.totalCostUsd).toBe(3)
  })

  it('is undefined for a contact that has never run a turn', () => {
    // The rule the rail depends on: no entry means no badge. A zeroed summary
    // here would put "$0.00" beside a conversation nobody has used.
    expect(summariesFor(index, ['never-run'])).toBeUndefined()
  })

  it('is undefined for an empty scope', () => {
    expect(summariesFor(index, [])).toBeUndefined()
  })

  it('ignores ids with no row instead of counting them as zero', () => {
    expect(summariesFor(index, ['a', 'never-run'])?.totalCostUsd).toBe(1)
    expect(summariesFor(index, ['a', 'never-run'])?.pricedEvents).toBe(1)
  })
})

describe('byContactId', () => {
  it('indexes by contact', () => {
    const index = byContactId([{ contactId: 'a', ...summary() }])
    expect(index.get('a')?.contactId).toBe('a')
    expect(index.get('b')).toBeUndefined()
  })
})
