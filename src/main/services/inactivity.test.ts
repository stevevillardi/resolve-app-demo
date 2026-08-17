import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  INACTIVITY_TIMEOUT_MS,
  inactivityTimeoutMs,
  setInactivityTimeoutForTests,
  withInactivityTimeout
} from './inactivity'

/**
 * Real timers with short, wide-margin durations rather than fake timers:
 * the wrapper races a timer against a pending `next()`, and vi.useFakeTimers
 * would need every await interleaved with an advance call — more machinery
 * than the tens of milliseconds these cost, and closer to how it runs.
 */

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

async function* immediate<T>(items: T[]): AsyncGenerator<T> {
  for (const item of items) yield item
}

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = []
  for await (const item of iterable) out.push(item)
  return out
}

function gate(): { promise: Promise<void>; open: () => void } {
  let open!: () => void
  const promise = new Promise<void>((resolve) => {
    open = resolve
  })
  return { promise, open }
}

describe('withInactivityTimeout', () => {
  it('passes every event through untouched when the stream stays lively', async () => {
    const onTimeout = vi.fn()
    const out = await collect(withInactivityTimeout(immediate([1, 2, 3]), 1000, onTimeout))

    expect(out).toEqual([1, 2, 3])
    expect(onTimeout).not.toHaveBeenCalled()
  })

  it('fires once when the stream goes silent, then keeps forwarding', async () => {
    const stall = gate()
    // onTimeout plays its real role: in runTurn it aborts the turn, which is
    // what unblocks the stream. Here it opens the gate.
    const onTimeout = vi.fn(() => stall.open())

    async function* source(): AsyncGenerator<string> {
      yield 'before'
      await stall.promise
      yield 'after'
    }

    const out = await collect(withInactivityTimeout(source(), 20, onTimeout))

    expect(onTimeout).toHaveBeenCalledTimes(1)
    // Events after the stop still flow — the adapters' own teardown yields
    // through the same stream, and swallowing it would skip their cleanup.
    expect(out).toEqual(['before', 'after'])
  })

  it('resets the clock on every event', async () => {
    const onTimeout = vi.fn()

    async function* source(): AsyncGenerator<number> {
      for (const n of [1, 2, 3, 4]) {
        await wait(25)
        yield n
      }
    }

    // Four 25ms gaps against a 80ms budget: cumulative time (100ms) exceeds
    // the timeout, so this only passes if each event rearms the timer.
    const out = await collect(withInactivityTimeout(source(), 80, onTimeout))

    expect(out).toEqual([1, 2, 3, 4])
    expect(onTimeout).not.toHaveBeenCalled()
  })

  it('never fires after the stream has completed', async () => {
    const onTimeout = vi.fn()
    await collect(withInactivityTimeout(immediate(['only']), 10, onTimeout))
    await wait(40)

    expect(onTimeout).not.toHaveBeenCalled()
  })

  it('fires only once however long the silence lasts afterwards', async () => {
    const first = gate()
    const second = gate()
    const onTimeout = vi.fn(() => first.open())

    async function* source(): AsyncGenerator<string> {
      await first.promise
      yield 'released'
      await second.promise
    }

    const done = collect(withInactivityTimeout(source(), 15, onTimeout))
    // Long enough for several would-be re-fires; the second silence must not
    // produce one — after a stop there is nothing left to protect.
    await wait(80)
    second.open()
    await done

    expect(onTimeout).toHaveBeenCalledTimes(1)
  })

  it('propagates a mid-stream failure instead of swallowing it', async () => {
    async function* source(): AsyncGenerator<number> {
      yield 1
      throw new Error('spawn ENOENT')
    }

    await expect(collect(withInactivityTimeout(source(), 1000, vi.fn()))).rejects.toThrow(
      'spawn ENOENT'
    )
  })
})

describe('the test seam', () => {
  afterEach(() => setInactivityTimeoutForTests(INACTIVITY_TIMEOUT_MS))

  it('defaults to ten minutes and follows the override', () => {
    expect(inactivityTimeoutMs()).toBe(INACTIVITY_TIMEOUT_MS)
    expect(INACTIVITY_TIMEOUT_MS).toBe(10 * 60_000)

    setInactivityTimeoutForTests(25)
    expect(inactivityTimeoutMs()).toBe(25)
  })
})
