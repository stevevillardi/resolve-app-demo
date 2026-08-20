import { previewLine, repoName } from './format'
import { aggregateUsage } from './usage'
import type {
  Contact,
  PersistedMessage,
  PersonaTemplate,
  Routine,
  UsageEvent,
  UsageSummary
} from '@/types'

/**
 * What the resting screen shows, worked out here rather than in the component.
 *
 * The renderer Vitest project matches `*.test.ts` only and there is no
 * @testing-library/react, so logic left inside a `.tsx` cannot be covered at
 * all. These are the parts of the home view worth being sure about — joining
 * three lists by id, and a spend window with a boundary in it.
 */

export interface RecentItem {
  contactId: string
  /** The persona's name, which is what the conversation list shows. */
  name: string
  color: string
  /** The persona's chosen robot seed. Absent when the persona is gone. */
  avatarSeed?: string
  repo: string
  preview: string
  timestamp: number
  role: 'user' | 'assistant'
}

/**
 * The newest turn per contact, newest first, joined to persona and repo.
 *
 * `messages.previews` already returns the latest row per contact, so this does
 * not re-group — it sorts, joins and truncates. A preview whose contact has
 * since been deleted is dropped rather than rendered nameless: the row's only
 * purpose is to be clicked into a thread that no longer exists.
 *
 * A contact whose *persona* is gone is kept, because personas.delete refuses
 * while contacts are bound to them — so that combination means something has
 * gone wrong, and silently hiding the conversation would be the wrong way to
 * say so.
 */
export function recentActivity(
  previews: PersistedMessage[],
  contacts: Contact[],
  personas: PersonaTemplate[],
  limit: number
): RecentItem[] {
  const contactById = new Map(contacts.map((contact) => [contact.id, contact]))
  const personaById = new Map(personas.map((persona) => [persona.id, persona]))

  return previews
    .filter((preview) => contactById.has(preview.contactId))
    .slice()
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, limit)
    .map((preview) => {
      const contact = contactById.get(preview.contactId) as Contact
      const persona = personaById.get(contact.personaTemplateId)
      return {
        contactId: contact.id,
        name: persona?.name ?? contact.displayName,
        color: persona?.avatarColor ?? 'var(--muted)',
        ...(persona ? { avatarSeed: persona.avatarSeed } : {}),
        repo: repoName(contact.repoPath),
        preview: previewLine(preview.content),
        timestamp: preview.timestamp,
        role: preview.role
      }
    })
}

export interface SpendWindow extends UsageSummary {
  turns: number
  /** How many days the figures cover, so the label can say so. */
  days: number
}

/**
 * Spend over the last `days`, counted from local midnight `days - 1` days back
 * — the same boundary the usage dashboard buckets on, so the two cannot
 * disagree about which day a turn belongs to.
 *
 * Delegates the money to `aggregateUsage`, which is what keeps `costUsd: null`
 * meaning "no published price" rather than zero, and keeps a partial total
 * rendering as `$12.34+`.
 */
export function spendWindow(events: UsageEvent[], now: number, days: number): SpendWindow {
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  start.setDate(start.getDate() - (days - 1))
  const from = start.getTime()

  const within = events.filter((event) => event.timestamp >= from)
  return { ...aggregateUsage(within), turns: within.length, days }
}

/**
 * How long a run has been going, at the coarsest useful precision.
 *
 * Seconds below a minute because the first thing you want to know about a turn
 * that just started is that it *has* started; minutes after that, because
 * nobody is counting seconds on a four-minute run.
 */
export function formatElapsed(startedAt: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${minutes % 60}m`
}

// --- Scheduled ---------------------------------------------------------------

export interface UpcomingRun {
  routineId: string
  prompt: string
  contactName: string | null
  nextRun: number
}

/**
 * The next few fires, soonest first. Routines whose engine cannot name a time
 * (disabled, unarmed) are dropped rather than shown as "not scheduled" — Home
 * answers "what happens next", and a row that answers "nothing" is the
 * Routines section's job.
 */
export function upcomingRuns(
  runs: { routineId: string; prompt: string; contactName: string | null; nextRun: number | null }[],
  limit: number
): UpcomingRun[] {
  return runs
    .filter((run): run is UpcomingRun => run.nextRun !== null)
    .sort((a, b) => a.nextRun - b.nextRun)
    .slice(0, limit)
}

export interface MissedRun {
  routineId: string
  prompt: string
  contactName: string | null
  count: number
  lastMissedAt: number
}

/**
 * Routines with scheduled fires that never ran, most recently missed first.
 *
 * Only routines currently carrying a miss appear — the counter is cleared by
 * any attempt, so this is "what is outstanding", not a history. A routine
 * whose contact is gone keeps its row with a null name rather than being
 * dropped: deleting the contact cascades the routine away entirely, so this
 * combination means something is wrong, and hiding it would be the wrong way
 * to say so.
 */
export function missedRuns(
  routines: {
    id: string
    contactId: string
    prompt: string
    missedRunCount: number
    lastMissedAt: number | null
  }[],
  contacts: Contact[],
  limit: number
): MissedRun[] {
  const contactById = new Map(contacts.map((contact) => [contact.id, contact]))

  return routines
    .filter((routine) => routine.missedRunCount > 0 && routine.lastMissedAt !== null)
    .sort((a, b) => (b.lastMissedAt ?? 0) - (a.lastMissedAt ?? 0))
    .slice(0, limit)
    .map((routine) => ({
      routineId: routine.id,
      prompt: routine.prompt,
      contactName: contactById.get(routine.contactId)?.displayName ?? null,
      count: routine.missedRunCount,
      lastMissedAt: routine.lastMissedAt as number
    }))
}

/**
 * Absolute and local, the tray's rule for the same data (tray-menu.ts): a
 * static snapshot must not say "in 12 minutes", because that starts lying the
 * moment it is drawn. Duplicated rather than imported — main code cannot be
 * imported into the renderer, and six lines is cheaper than a shared module
 * for one format.
 */
export function formatUpcoming(at: number, now: number): string {
  const when = new Date(at)
  const time = when.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  const start = new Date(now)
  const end = new Date(at)
  start.setHours(0, 0, 0, 0)
  end.setHours(0, 0, 0, 0)
  const days = Math.round((end.getTime() - start.getTime()) / 86_400_000)

  if (days === 0) return `today ${time}`
  if (days === 1) return `tomorrow ${time}`
  return `${when.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })} ${time}`
}

// --- Degraded auth -----------------------------------------------------------

interface AuthStatusLike {
  claude: { error?: string }
  codex: { error?: string }
  github: { tokenState?: 'unverified' | 'good' | 'rejected' | 'unreachable' | 'locked' }
}

export interface AuthBanner {
  kind: 'github' | 'backend'
  message: string
}

/**
 * The one degraded-auth state worth a banner on the resting screen, or null.
 *
 * `rejected` only, never `unreachable` — offline must not read as "go fix your
 * credentials". Backend probe *errors* rank below a rejected GitHub token
 * because they are usually transient detection failures (the probe self-heals
 * on focus), while a revoked token stays revoked until a human acts.
 */
export function authBannerFor(status: AuthStatusLike | undefined): AuthBanner | null {
  if (!status) return null
  if (status.github.tokenState === 'rejected') {
    return {
      kind: 'github',
      message:
        'GitHub rejected the stored token. Reconnect to keep repository browsing and pull requests working.'
    }
  }
  if (status.github.tokenState === 'locked') {
    return {
      kind: 'github',
      message:
        "The stored GitHub credential can't be unlocked by this build of the app. Reconnect once to re-save it — nothing was revoked."
    }
  }
  const backendError = status.claude.error ?? status.codex.error
  if (backendError) return { kind: 'backend', message: backendError }
  return null
}

// --- Spend sparkline ---------------------------------------------------------

export interface DailySpendPoint {
  day: number
  label: string
  cost: number
}

/**
 * Cost per calendar day for the trailing window, zero-filled.
 *
 * Not lib/usage-report's bucketByDay: that spans the *events'* range and keys
 * by a selector for the dashboard's stacked series. A sparkline needs the
 * opposite guarantees — exactly `days` buckets ending today, empty days
 * present as zeros so a quiet week does not compress into two bars.
 */
export function dailySpend(events: UsageEvent[], now: number, days: number): DailySpendPoint[] {
  const points: DailySpendPoint[] = []
  const cursor = new Date(now)
  cursor.setHours(0, 0, 0, 0)
  // Walk back by calendar day rather than by 86_400_000, so a DST transition
  // does not shift every earlier bucket by an hour.
  cursor.setDate(cursor.getDate() - (days - 1))

  for (let i = 0; i < days; i += 1) {
    const start = cursor.getTime()
    const next = new Date(cursor)
    next.setDate(next.getDate() + 1)
    const end = next.getTime()

    points.push({
      day: start,
      label: new Date(start).toLocaleDateString(undefined, { weekday: 'short' }),
      cost: events
        .filter((event) => event.timestamp >= start && event.timestamp < end)
        .reduce((sum, event) => sum + (event.costUsd ?? 0), 0)
    })
    cursor.setDate(cursor.getDate() + 1)
  }
  return points
}

/**
 * Each day's bar height, as a percentage of the tallest day in the window.
 *
 * Two rules that a bare `cost / max` does not give you. A day that spent
 * *something* never draws as nothing: below the floor a real turn is
 * indistinguishable from a quiet day, which is the one comparison the strip
 * exists to make. And a day that spent nothing draws nothing at all — its
 * track is still there, so seven days always read as seven days.
 *
 * All zeros when the window has no priced spend in it: turns on a model with
 * no published price report `costUsd: null`, and scaling those to full height
 * would invent a week out of an absence of prices.
 */
export function spendBarPercents(points: DailySpendPoint[]): number[] {
  const max = Math.max(0, ...points.map((point) => point.cost))
  if (max <= 0) return points.map(() => 0)
  return points.map((point) =>
    point.cost <= 0 ? 0 : Math.max(SPEND_BAR_FLOOR, (point.cost / max) * 100)
  )
}

/** Percent of the track below which a bar stops reading as a bar. */
const SPEND_BAR_FLOOR = 8

// --- Budget banner -----------------------------------------------------------

export interface BudgetBanner {
  /** "Switchboard" for the app scope, the routine's prompt preview otherwise. */
  scopeLabel: string
  floorUsd: number
  budgetUsd: number
  /** True when the month also holds unpriced turns — the figure is a floor. */
  hasUnpriced: boolean
  message: string
}

/**
 * The month-to-date crossing worth a banner on Home, or null.
 *
 * Mirrors main's budget.ts semantics exactly — priced floor, local calendar
 * month — because the banner and the toast describing the same crossing must
 * not disagree about the number. "At least $X" when unpriced turns exist, the
 * same honesty rule as `$12.34+`. When several scopes are crossed, the worst
 * overage wins: one banner, not a stack.
 */
export function budgetBannerFor(
  events: UsageEvent[],
  appBudgetUsd: number | null,
  routines: Routine[],
  now: number
): BudgetBanner | null {
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  start.setDate(1)
  const from = start.getTime()
  const month = events.filter((event) => event.timestamp >= from && event.timestamp <= now)

  const floor = (rows: UsageEvent[]): { floorUsd: number; hasUnpriced: boolean } => ({
    floorUsd: rows.reduce((sum, row) => sum + (row.costUsd ?? 0), 0),
    hasUnpriced: rows.some((row) => row.costUsd === null)
  })

  const candidates: BudgetBanner[] = []

  if (appBudgetUsd !== null && appBudgetUsd > 0) {
    const { floorUsd, hasUnpriced } = floor(month)
    if (floorUsd >= appBudgetUsd) {
      candidates.push(banner('Switchboard', floorUsd, appBudgetUsd, hasUnpriced))
    }
  }

  for (const routine of routines) {
    if (routine.monthlyBudgetUsd === null || routine.monthlyBudgetUsd <= 0) continue
    const own = month.filter((event) => event.routineId === routine.id)
    const { floorUsd, hasUnpriced } = floor(own)
    if (floorUsd >= routine.monthlyBudgetUsd) {
      // The renderer's previewLine takes no cap; clamp here so a paragraph
      // prompt cannot become the whole banner.
      const label = previewLine(routine.prompt).slice(0, 60)
      candidates.push(banner(label, floorUsd, routine.monthlyBudgetUsd, hasUnpriced))
    }
  }

  if (candidates.length === 0) return null
  return candidates.sort((a, b) => b.floorUsd / b.budgetUsd - a.floorUsd / a.budgetUsd)[0]
}

function banner(
  scopeLabel: string,
  floorUsd: number,
  budgetUsd: number,
  hasUnpriced: boolean
): BudgetBanner {
  const spent = `${hasUnpriced ? 'at least ' : ''}$${floorUsd.toFixed(2)}`
  return {
    scopeLabel,
    floorUsd,
    budgetUsd,
    hasUnpriced,
    message: `${scopeLabel} has spent ${spent} of its $${budgetUsd.toFixed(2)} monthly budget. Nothing has been stopped.`
  }
}
