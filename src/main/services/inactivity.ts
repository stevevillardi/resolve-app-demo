/**
 * The turn watchdog (review §B5): a wedged backend turn used to stream
 * nothing forever while holding the repo's write lock, and the only way out
 * was a human noticing and clicking Stop.
 *
 * Inactivity rather than wall-clock, deliberately: a legitimate turn can run
 * for half an hour while emitting tool events the whole way, and killing it
 * for being thorough would be worse than the disease. A stalled one goes
 * silent — so the timer measures silence, resetting on every event.
 *
 * The wrapper never terminates the stream itself. On silence it calls
 * `onTimeout` once — whose job (in runTurn) is to record why and abort the
 * turn's controller — and then keeps forwarding events, because the abort is
 * exactly what makes the adapter's iterator finish: both SDKs respond to it
 * by killing their subprocess and yielding a final error + done. Ending the
 * stream here instead would skip the adapters' own teardown.
 */

export const INACTIVITY_TIMEOUT_MS = 10 * 60_000

let timeoutMs = INACTIVITY_TIMEOUT_MS

/** Read per turn rather than imported as a constant, so tests can lower it. */
export function inactivityTimeoutMs(): number {
  return timeoutMs
}

export function setInactivityTimeoutForTests(ms: number): void {
  timeoutMs = ms
}

export async function* withInactivityTimeout<T>(
  iterable: AsyncIterable<T>,
  ms: number,
  onTimeout: () => void
): AsyncGenerator<T, void, unknown> {
  const iterator = iterable[Symbol.asyncIterator]()
  let fired = false

  while (true) {
    const step = iterator.next()

    if (!fired) {
      let timer: NodeJS.Timeout | undefined
      const timedOut = await Promise.race([
        step.then(
          () => false,
          () => false
        ),
        new Promise<boolean>((resolve) => {
          timer = setTimeout(() => resolve(true), ms)
        })
      ])
      clearTimeout(timer)
      if (timedOut) {
        fired = true
        onTimeout()
      }
    }

    // Rejections propagate from here, not from the race above — the race
    // swallows them so a failure during the timed window is not reported
    // twice, once as an unhandled rejection and once for real.
    const result = await step
    if (result.done) return
    yield result.value
  }
}
