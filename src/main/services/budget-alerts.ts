import { gte } from 'drizzle-orm'
import { initDb } from '../db'
import { toUsageEvent } from '../db/mappers'
import { usageEvents } from '../db/schema'
import { budgetNotification, previewLine } from '../notification-text'
import { sendNotification } from '../notifications'
import { getAppState, getAppStateNumber, setAppState } from './app-state'
import { crossedBudget, monthKey, monthlyFloor, monthStart } from './budget'
import { getRoutine } from './routines'

/**
 * The soft monthly budget alert, hung off the seam usage-events.ts leaves for
 * it: every turn's spend passes through recordUsage, and this runs right after
 * each row lands. The app alerts and never enforces — nothing here, or
 * anywhere else, stops, pauses or refuses work over a budget, and the copy
 * says so.
 *
 * Edge-triggered, once per month per scope. recordUsage fires on every turn,
 * so a naive check would toast for the rest of the month after the first
 * crossing; `budget_alerts_fired` remembers which month each scope last
 * alerted for, sticky across restarts (the github_token_state trick), and the
 * month rolling over is what re-arms it. A backwards system clock can re-alert
 * — accepted, not defended against.
 */

/** How the routine is named in its alert — same preview the toasts use. */
const SCOPE_NAME_MAX = 60

export function checkBudgetsAfterUsage(event: { timestamp: number; routineId?: string }): void {
  const key = monthKey(event.timestamp)
  const fired = readFired()
  let changed = false

  const appBudget = getAppStateNumber('monthly_budget_usd')
  if (appBudget !== null && fired['app'] !== key) {
    const { floorUsd, hasUnpriced } = monthlyFloor(monthEvents(event.timestamp), event.timestamp)
    if (crossedBudget(floorUsd, appBudget)) {
      sendNotification(budgetNotification('Switchboard', floorUsd, appBudget, hasUnpriced), {
        kind: 'home'
      })
      fired['app'] = key
      changed = true
    }
  }

  const routine = event.routineId ? getRoutine(event.routineId) : null
  if (routine && routine.monthlyBudgetUsd !== null && fired[`routine:${routine.id}`] !== key) {
    const own = monthEvents(event.timestamp).filter((row) => row.routineId === routine.id)
    const { floorUsd, hasUnpriced } = monthlyFloor(own, event.timestamp)
    if (crossedBudget(floorUsd, routine.monthlyBudgetUsd)) {
      sendNotification(
        budgetNotification(
          previewLine(routine.prompt, SCOPE_NAME_MAX),
          floorUsd,
          routine.monthlyBudgetUsd,
          hasUnpriced
        ),
        { kind: 'home' }
      )
      fired[`routine:${routine.id}`] = key
      changed = true
    }
  }

  if (changed) writeFired(fired, key)
}

function monthEvents(
  now: number
): { timestamp: number; costUsd: number | null; routineId?: string }[] {
  return initDb()
    .select()
    .from(usageEvents)
    .where(gte(usageEvents.timestamp, new Date(monthStart(now))))
    .all()
    .map(toUsageEvent)
}

function readFired(): Record<string, string> {
  const raw = getAppState('budget_alerts_fired')
  if (!raw) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {}
  } catch {
    // A corrupted map re-arms every scope, which errs toward one extra toast
    // rather than a permanently silenced alert.
    return {}
  }
}

function writeFired(fired: Record<string, string>, currentKey: string): void {
  // Entries for past months are spent — the roll-over already re-armed those
  // scopes — and entries for deleted routines never match again. Keeping only
  // the current month's prunes both without a second bookkeeping pass.
  const pruned = Object.fromEntries(
    Object.entries(fired).filter(([, month]) => month === currentKey)
  )
  setAppState('budget_alerts_fired', JSON.stringify(pruned))
}
