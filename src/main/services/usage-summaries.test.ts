import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestDb } from '../db/test-db'
import { contacts, personaTemplates, usageEvents } from '../db/schema'
import { aggregateUsage } from '../../shared/usage-summary'
import type { AppDatabase } from '../db/create'
import type { UsageEvent } from '../../shared/domain'

/**
 * `usage.summaries` against a real :memory: database (Phase 25 §B1).
 *
 * This is a **second implementation of a spend calculation**. The renderer's
 * `aggregateUsage` still runs wherever it already holds raw events, so the two
 * have to agree, and the way that goes wrong is quietly: a total that reads
 * `$12.34` where the other says `$12.34+`, or `$0.00` where the other says `—`.
 *
 * So most of these do not assert a hand-written number. They run both
 * implementations over the same rows and compare — which is the only assertion
 * that keeps failing if either side drifts, and the reason the SQL is worth
 * having at all rather than being trusted on inspection.
 */

let db: AppDatabase
vi.mock('../db', () => ({ initDb: () => db }))

const { usageSummariesByContact } = await import('./usage-events')
const { toUsageEvent } = await import('../db/mappers')

let eventCount = 0

function contact(id: string): void {
  db.insert(contacts)
    .values({ id, personaTemplateId: 'p1', repoPath: `/repo/${id}`, displayName: id })
    .run()
}

function spend(
  contactId: string | null,
  costUsd: number | null,
  extra: { cachedInputTokens?: number; inputTokens?: number; outputTokens?: number } = {}
): void {
  eventCount += 1
  db.insert(usageEvents)
    .values({
      id: `u-${eventCount}`,
      contactId,
      personaTemplateId: 'p1',
      repoPath: contactId ? `/repo/${contactId}` : '/repo/gone',
      timestamp: new Date(1_700_000_000_000 + eventCount * 1000),
      source: 'message',
      inputTokens: extra.inputTokens ?? 100,
      outputTokens: extra.outputTokens ?? 10,
      costUsd,
      costSource: 'computed',
      ...(extra.cachedInputTokens !== undefined && { cachedInputTokens: extra.cachedInputTokens })
    })
    .run()
}

/** What the renderer would compute from the same rows, for one contact. */
function viaRenderer(contactId: string): ReturnType<typeof aggregateUsage> {
  const rows: UsageEvent[] = db
    .select()
    .from(usageEvents)
    .all()
    .map(toUsageEvent)
    .filter((event) => event.contactId === contactId)
  return aggregateUsage(rows)
}

beforeEach(() => {
  db = createTestDb()
  eventCount = 0
  db.insert(personaTemplates)
    .values({
      id: 'p1',
      name: 'Code Reviewer',
      avatarColor: '#2a78d6',
      backend: 'claude',
      systemPrompt: '',
      skillIds: [],
      sandbox: 'read_only',
      githubScope: 'read_only'
    })
    .run()
})

describe('usageSummariesByContact', () => {
  it('agrees with aggregateUsage on a mix of priced and unpriced turns', () => {
    contact('c1')
    spend('c1', 0.25)
    spend('c1', null)
    spend('c1', 0.5)

    const [summary] = usageSummariesByContact()

    // The whole claim: same rows, same answer, both implementations.
    expect(summary).toEqual({ contactId: 'c1', ...viaRenderer('c1') })
    // Named explicitly too, because this is the case `formatCostSummary` turns
    // into `$0.75+` — a floor, not a figure. A rollup that dropped
    // `unpricedEvents` would still pass a total-only assertion.
    expect(summary.unpricedEvents).toBe(1)
    expect(summary.pricedEvents).toBe(2)
    expect(summary.totalCostUsd).toBeCloseTo(0.75, 10)
  })

  it('reports an all-unpriced contact as unknown, never as free', () => {
    contact('c1')
    spend('c1', null)
    spend('c1', null)

    const [summary] = usageSummariesByContact()

    // `SUM(cost_usd)` over all-NULL returns NULL, which is what we want and why
    // there is no COALESCE. A `0` here renders as "$0.00" — "this was free" —
    // about turns whose price this app simply does not know.
    expect(summary.totalCostUsd).toBeNull()
    expect(summary).toEqual({ contactId: 'c1', ...viaRenderer('c1') })
  })

  it('omits cached tokens entirely when no turn reported any', () => {
    contact('c1')
    spend('c1', 0.1)

    const [summary] = usageSummariesByContact()

    // Absent, not zero: "the backend never told us" is not "nothing was
    // cached", and the renderer's own rollup makes the same distinction.
    expect('totalCachedInputTokens' in summary).toBe(false)
    expect(summary).toEqual({ contactId: 'c1', ...viaRenderer('c1') })
  })

  it('sums cached tokens across the turns that have them', () => {
    contact('c1')
    spend('c1', 0.1, { cachedInputTokens: 400 })
    spend('c1', 0.1)
    spend('c1', 0.1, { cachedInputTokens: 600 })

    const [summary] = usageSummariesByContact()

    expect(summary.totalCachedInputTokens).toBe(1000)
    expect(summary).toEqual({ contactId: 'c1', ...viaRenderer('c1') })
  })

  it('keeps one row per contact and does not bleed across them', () => {
    contact('c1')
    contact('c2')
    spend('c1', 1)
    spend('c2', 2)
    spend('c2', 4)

    const byId = new Map(usageSummariesByContact().map((s) => [s.contactId, s]))

    expect([...byId.keys()].sort()).toEqual(['c1', 'c2'])
    expect(byId.get('c1')).toEqual({ contactId: 'c1', ...viaRenderer('c1') })
    expect(byId.get('c2')).toEqual({ contactId: 'c2', ...viaRenderer('c2') })
  })

  it('leaves a contact that has never run a turn out of the result', () => {
    contact('c1')

    // Absent rather than a zeroed row. The rail renders a missing entry as no
    // badge; a `$0.00` badge would claim a turn happened and was free.
    expect(usageSummariesByContact()).toEqual([])
  })

  it('excludes spend whose contact has been deleted', () => {
    contact('c1')
    spend('c1', 1)
    spend(null, 9)

    const summaries = usageSummariesByContact()

    // Phase 10's rule is that spend outlives what spent it, so the row is still
    // in the table — but it has no contact to attribute to, and grouping it
    // under a null key would render it as one mystery conversation. The
    // dashboard's unscoped totals are where it stays visible.
    expect(summaries).toHaveLength(1)
    expect(summaries[0]!.contactId).toBe('c1')
    expect(summaries[0]!.totalCostUsd).toBe(1)
  })
})
