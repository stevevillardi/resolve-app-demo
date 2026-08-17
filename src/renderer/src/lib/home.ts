import { previewLine, repoName } from './format'
import { aggregateUsage } from './usage'
import type { Contact, PersistedMessage, PersonaTemplate, UsageEvent, UsageSummary } from '@/types'

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
  /** The persona's id — the avatar seed. Absent when the persona is gone. */
  personaId?: string
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
        ...(persona ? { personaId: persona.id } : {}),
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
