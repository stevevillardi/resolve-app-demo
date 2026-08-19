import { useEffect, useState } from 'react'

/**
 * A once-a-second clock for surfaces that time running turns (Phase 25;
 * extracted from WorkspaceHome). Nothing else invalidates while a turn is
 * simply continuing to run, so elapsed labels have to re-render on their own —
 * but only while something is actually running, which is what `active` gates:
 * an idle screen holds one stale timestamp and no timer.
 */
export function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    // No synchronous refresh here (the set-state-in-effect rule): the first
    // tick lands within a second, which is inside the label's own precision.
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [active])
  return now
}
