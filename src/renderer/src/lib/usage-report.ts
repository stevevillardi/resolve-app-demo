import { repoName } from '@/lib/format'
import { aggregateUsage } from '@/lib/usage'
import type { UsageScope } from '@/store/useUiStore'
import type { Contact, PersonaTemplate, UsageEvent, UsageSource, UsageSummary } from '@/types'

/**
 * The dashboard's arithmetic, kept out of the dashboard.
 *
 * Everything here is pure and lives in lib/ deliberately: the Vitest renderer
 * project matches `*.test.ts` only and there is no component-render harness, so
 * logic left inside a .tsx is logic nothing can test. UsageDashboard is a
 * presentation shell over these functions.
 */

/** What a chart or a breakdown is measuring. */
export type UsageMetric = 'cost' | 'tokens'

/** The bucket unpriced/unrecorded models fall into. Never folded into a default. */
export const UNKNOWN_MODEL = 'unknown'

export interface UsageFilter {
  /** Inclusive lower bound, ms. Omit for "since the beginning". */
  from?: number
  /** Exclusive upper bound, ms. Omit for "up to now". */
  to?: number
  /** Keep only these sources. Omit for all four. */
  sources?: UsageSource[]
  /** Keep only these contacts. Omit for all. */
  contactIds?: string[]
}

/**
 * The contacts a scope covers, or `null` for "every contact" — which is not the
 * same as the empty array, and the difference is load-bearing: `filterUsage`
 * reads `[]` as "no contacts" so an empty scope shows nothing rather than
 * everything.
 */
export function contactIdsForScope(contacts: Contact[], scope: UsageScope): string[] | null {
  if (scope.kind === 'all') return null
  const match =
    scope.kind === 'persona'
      ? (contact: Contact): boolean => contact.personaTemplateId === scope.id
      : (contact: Contact): boolean => contact.repoPath === scope.repoPath
  return contacts.filter(match).map((contact) => contact.id)
}

export function filterUsage(events: UsageEvent[], filter: UsageFilter = {}): UsageEvent[] {
  const { from, to, sources, contactIds } = filter
  const allowedSources = sources ? new Set(sources) : null
  const allowedContacts = contactIds ? new Set(contactIds) : null

  return events.filter((event) => {
    if (from !== undefined && event.timestamp < from) return false
    if (to !== undefined && event.timestamp >= to) return false
    if (allowedSources && !allowedSources.has(event.source)) return false
    if (allowedContacts && !allowedContacts.has(event.contactId)) return false
    return true
  })
}

/**
 * How an event maps onto one row of a breakdown.
 *
 * `key` is a stable identity — it keys the chart series and its colour, so it
 * must not change with sort order (dataviz: colour follows identity, never
 * rank). `color` is only set where the dimension has an inherent one; a persona
 * carries its avatar colour so the chart and the sidebar agree.
 */
export interface UsageBucketKey {
  key: string
  label: string
  color?: string
}

export type UsageSelector = (event: UsageEvent) => UsageBucketKey

export interface UsageGroup extends UsageBucketKey {
  summary: UsageSummary
  /** Input + output. Always known, even when cost is not. */
  tokens: number
  /** Sum of the priced turns only — read alongside `summary.unpricedEvents`. */
  cost: number | null
  events: number
}

/**
 * One rollup driving every breakdown. The dimension is the selector, so persona,
 * repo, model and source differ by one function rather than by four copies of
 * this loop.
 *
 * Sorted by the chosen metric, descending, with unpriced-only groups last: on a
 * cost chart they measure zero but are not zero, so leading with them would put
 * the least-known rows at the top.
 */
export function groupUsage(
  events: UsageEvent[],
  selector: UsageSelector,
  metric: UsageMetric = 'cost'
): UsageGroup[] {
  const buckets = new Map<string, { key: UsageBucketKey; events: UsageEvent[] }>()

  for (const event of events) {
    const key = selector(event)
    const bucket = buckets.get(key.key)
    if (bucket) bucket.events.push(event)
    else buckets.set(key.key, { key, events: [event] })
  }

  return [...buckets.values()]
    .map(({ key, events: bucketEvents }) => {
      const summary = aggregateUsage(bucketEvents)
      return {
        ...key,
        summary,
        tokens: summary.totalInputTokens + summary.totalOutputTokens,
        cost: summary.totalCostUsd,
        events: bucketEvents.length
      }
    })
    .sort((a, b) => {
      if (metric === 'tokens') return b.tokens - a.tokens
      if (a.cost === null && b.cost === null) return b.tokens - a.tokens
      if (a.cost === null) return 1
      if (b.cost === null) return -1
      return b.cost - a.cost
    })
}

// --- Dimensions -------------------------------------------------------------
// Each returns a selector. The contact-derived ones need the join, so they take
// it once and close over it rather than re-scanning per event.

export function byPersona(contacts: Contact[], personas: PersonaTemplate[]): UsageSelector {
  const contactById = new Map(contacts.map((contact) => [contact.id, contact]))
  const personaById = new Map(personas.map((persona) => [persona.id, persona]))

  return (event) => {
    const persona = personaById.get(contactById.get(event.contactId)?.personaTemplateId ?? '')
    // A deleted persona still has spend, and it is not nobody's.
    if (!persona) return { key: 'unknown-persona', label: 'Unknown persona' }
    return { key: persona.id, label: persona.name, color: persona.avatarColor }
  }
}

export function byRepo(contacts: Contact[]): UsageSelector {
  const contactById = new Map(contacts.map((contact) => [contact.id, contact]))

  return (event) => {
    const repoPath = contactById.get(event.contactId)?.repoPath
    if (!repoPath) return { key: 'unknown-repo', label: 'Unknown repo' }
    // Keyed by full path, labelled by basename: two checkouts can share a name.
    return { key: repoPath, label: repoName(repoPath) }
  }
}

/**
 * Groups on the model recorded on the event, never the persona's current one.
 *
 * A persona's model can change; its history cannot. Reading the persona's
 * setting would reprice every past turn the moment someone switches, and prices
 * differ by an order of magnitude between models. Rows written before migration
 * 0004 carry no model at all, which is why "unknown" is a real bucket here
 * rather than a default to fold them into.
 */
export function byModel(): UsageSelector {
  return (event) =>
    event.model
      ? { key: event.model, label: event.model }
      : { key: UNKNOWN_MODEL, label: 'Unknown model' }
}

export const SOURCE_LABEL: Record<UsageSource, string> = {
  message: 'Messages',
  routine: 'Routines',
  mention: 'Mentions',
  summary: 'Summaries'
}

/**
 * Splits spend by what asked for it. `routine` is the one that matters most —
 * it is the only unsupervised spend, and blueprint §7 wants it visible on its
 * own. `summary` is what coordination costs (Phase 7).
 */
export function bySource(): UsageSelector {
  return (event) => ({ key: event.source, label: SOURCE_LABEL[event.source] })
}

// --- Series identity --------------------------------------------------------

/**
 * The design system's categorical slots, already validated for CVD and for
 * both surfaces (see the note above `--chart-1` in assets/main.css). Consumed
 * rather than re-picked: a second palette beside a validated one is how a chart
 * ends up with two hues nobody checked against each other.
 *
 * Used for the dimensions with no colour of their own. A persona keeps its
 * avatar colour, so the chart and the sidebar agree about who is who.
 */
export const CHART_PALETTE = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)'
] as const

/**
 * Stable, CSS-safe ids for a set of series keys.
 *
 * The chart wrapper emits a `--color-<key>` custom property per series, and a
 * repo path is not a legal custom-property name. Ids are assigned over the
 * *complete* sorted key set rather than whatever survived the current filter,
 * so a series keeps its id — and therefore its colour — when the range or the
 * source filter changes. Colour follows identity, never rank.
 */
export function seriesIds(keys: string[]): Map<string, string> {
  return new Map([...new Set(keys)].sort().map((key, index) => [key, `s${index}`]))
}

// --- Time series ------------------------------------------------------------

/** Local midnight for a timestamp — the day boundary a desktop user means. */
export function dayStart(timestamp: number): number {
  return new Date(timestamp).setHours(0, 0, 0, 0)
}

export function metricValue(event: UsageEvent, metric: UsageMetric): number {
  if (metric === 'tokens') return event.inputTokens + event.outputTokens
  // An unpriced turn contributes nothing to a cost bar. It is not free — the
  // unpriced count travels alongside so the caller can say so.
  return event.costUsd ?? 0
}

/** One day's stacked bar: `day`/`label` plus one numeric field per series key. */
export interface DailyBucket {
  day: number
  label: string
  /** Turns in this day whose cost is unknown, across every series. */
  unpricedEvents: number
  [seriesKey: string]: number | string
}

/**
 * Buckets events into local days, one numeric field per series.
 *
 * Every day between the first and last event is present even when nothing
 * happened, so the axis reads as time rather than as a list of days that had
 * activity — a gap is information, and a chart that closes it lies about pace.
 */
export function bucketByDay(
  events: UsageEvent[],
  selector: UsageSelector,
  metric: UsageMetric = 'cost'
): DailyBucket[] {
  if (events.length === 0) return []

  const byDay = new Map<number, DailyBucket>()
  let min = Infinity
  let max = -Infinity

  for (const event of events) {
    const day = dayStart(event.timestamp)
    min = Math.min(min, day)
    max = Math.max(max, day)

    const bucket = byDay.get(day) ?? { day, label: dayLabel(day), unpricedEvents: 0 }
    const key = selector(event).key
    bucket[key] = ((bucket[key] as number | undefined) ?? 0) + metricValue(event, metric)
    if (event.costUsd === null) bucket.unpricedEvents += 1
    byDay.set(day, bucket)
  }

  const days: DailyBucket[] = []
  // Step by calendar day rather than by +86_400_000, so a DST transition does
  // not shift every subsequent bucket by an hour.
  for (let cursor = new Date(min); cursor.getTime() <= max; cursor.setDate(cursor.getDate() + 1)) {
    const day = cursor.getTime()
    days.push(byDay.get(day) ?? { day, label: dayLabel(day), unpricedEvents: 0 })
  }
  return days
}

function dayLabel(day: number): string {
  return new Date(day).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/**
 * The inclusive lower bound for a "last N days" window, counting today as one
 * of them. Takes `now` rather than reading the clock so it stays pure.
 */
export function rangeStart(days: number, now: number): number {
  const start = new Date(dayStart(now))
  start.setDate(start.getDate() - (days - 1))
  return start.getTime()
}
