import { describe, expect, it } from 'vitest'
import { crossedBudget, monthKey, monthlyFloor, monthStart } from './budget'

/**
 * The money boundaries: local month edges, and the null-cost rule. Written
 * from the claims, because "looks right, wrong at a boundary" is exactly how
 * a spend figure fails — a turn on the 1st at 00:00, a month of unpriced
 * models, a floor that equals the budget to the cent.
 */

function at(iso: string): number {
  return new Date(iso).getTime()
}

describe('monthStart', () => {
  it('is local midnight on the 1st', () => {
    const start = new Date(monthStart(at('2026-08-17T15:30:00')))
    expect(start.getDate()).toBe(1)
    expect(start.getMonth()).toBe(7)
    expect(start.getHours()).toBe(0)
    expect(start.getMinutes()).toBe(0)
  })

  it('is idempotent at the boundary itself', () => {
    const first = monthStart(at('2026-08-01T00:00:00'))
    expect(monthStart(first)).toBe(first)
  })
})

describe('monthKey', () => {
  it('zero-pads and stays local', () => {
    expect(monthKey(at('2026-08-17T12:00:00'))).toBe('2026-08')
    expect(monthKey(at('2026-01-02T12:00:00'))).toBe('2026-01')
  })

  it('changes exactly when the month rolls', () => {
    expect(monthKey(at('2026-08-31T23:59:59'))).not.toBe(monthKey(at('2026-09-01T00:00:00')))
  })
})

describe('monthlyFloor', () => {
  const NOW = at('2026-08-17T12:00:00')

  it('sums only this month, and only priced rows', () => {
    const { floorUsd, hasUnpriced } = monthlyFloor(
      [
        { timestamp: at('2026-08-02T10:00:00'), costUsd: 1.5 },
        { timestamp: at('2026-08-10T10:00:00'), costUsd: null },
        { timestamp: at('2026-07-31T23:59:59'), costUsd: 100 }
      ],
      NOW
    )

    expect(floorUsd).toBe(1.5)
    expect(hasUnpriced).toBe(true)
  })

  it('includes a turn landing exactly at the month boundary', () => {
    const boundary = monthStart(NOW)
    expect(monthlyFloor([{ timestamp: boundary, costUsd: 2 }], NOW).floorUsd).toBe(2)
  })

  // The corollary, accepted rather than patched with a guess: all-unpriced
  // means floor $0, which means never alerting.
  it('is zero for an all-unpriced month, with the flag raised', () => {
    const { floorUsd, hasUnpriced } = monthlyFloor([{ timestamp: NOW - 1000, costUsd: null }], NOW)
    expect(floorUsd).toBe(0)
    expect(hasUnpriced).toBe(true)
  })

  it('reports a fully-priced month as such', () => {
    expect(monthlyFloor([{ timestamp: NOW - 1000, costUsd: 3 }], NOW).hasUnpriced).toBe(false)
  })
})

describe('crossedBudget', () => {
  it('crosses at the threshold exactly, not a cent later', () => {
    expect(crossedBudget(25, 25)).toBe(true)
    expect(crossedBudget(24.99, 25)).toBe(false)
  })

  // A zero budget would alert on the month's first priced cent forever; it
  // reads as "unset", not "alert always".
  it('treats a non-positive budget as no budget', () => {
    expect(crossedBudget(100, 0)).toBe(false)
    expect(crossedBudget(100, -5)).toBe(false)
  })
})
