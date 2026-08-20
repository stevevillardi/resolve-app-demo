import { describe, expect, it, vi } from 'vitest'
import type { AppDatabase } from '../db/create'

/**
 * `mapLimit` on its own, away from git.
 *
 * `listPersonaBranches` fans out over repositories through this, and the whole
 * reason it is bounded rather than a bare `Promise.all` is a property no
 * assertion about branches could see: how many calls are in flight at once.
 * Executing the function is the only way to check that, so it is exported and
 * tested here rather than read.
 *
 * branches.ts pulls in the database and electron at import time; neither is
 * reached by this helper, and both are stubbed so the import resolves.
 */
vi.mock('../db', () => ({ initDb: () => ({}) as AppDatabase }))
vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }))

const { mapLimit } = await import('./branches')

/** Resolves on the next macrotask, so interleaving is observable. */
function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

describe('mapLimit', () => {
  it('returns results in input order, not completion order', async () => {
    // The first item is the slowest. A naive implementation that pushed as each
    // settled would put it last — and `listPersonaBranches` would then be
    // sorting a list whose contents depended on which repo git answered first.
    const result = await mapLimit([30, 20, 10], 3, async (delay) => {
      await new Promise((resolve) => setTimeout(resolve, delay))
      return delay
    })

    expect(result).toEqual([30, 20, 10])
  })

  it('never has more than `limit` calls in flight', async () => {
    let inFlight = 0
    let peak = 0

    await mapLimit(
      Array.from({ length: 12 }, (_, i) => i),
      4,
      async (i) => {
        inFlight += 1
        peak = Math.max(peak, inFlight)
        await tick()
        inFlight -= 1
        return i
      }
    )

    // The claim this helper exists for. A `Promise.all(items.map(fn))` passes
    // every other case here and fails exactly this one, which is the point:
    // uncapped, twenty repos of five branches ask the OS for three hundred
    // concurrent git subprocesses.
    expect(peak).toBe(4)
  })

  it('processes every item even when there are more than the limit', async () => {
    const seen: number[] = []

    const result = await mapLimit([1, 2, 3, 4, 5, 6, 7], 2, async (n) => {
      await tick()
      seen.push(n)
      return n * 2
    })

    expect(seen.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(result).toEqual([2, 4, 6, 8, 10, 12, 14])
  })

  it('spawns nothing for an empty list', async () => {
    const fn = vi.fn()
    expect(await mapLimit([], 4, fn)).toEqual([])
    expect(fn).not.toHaveBeenCalled()
  })

  it('runs a list shorter than the limit without idling on missing work', async () => {
    // Math.min(limit, length) workers: three workers for three items, not four
    // where the fourth immediately finds nothing to do.
    expect(await mapLimit([1, 2], 8, async (n) => n + 1)).toEqual([2, 3])
  })
})
