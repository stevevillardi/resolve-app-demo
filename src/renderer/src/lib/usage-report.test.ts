import { describe, expect, it } from 'vitest'
import type { Contact, PersonaTemplate, UsageEvent } from '@/types'
import {
  UNKNOWN_MODEL,
  bucketByDay,
  byModel,
  byPersona,
  byRepo,
  bySource,
  dayStart,
  filterUsage,
  groupUsage,
  metricValue,
  rangeStart
} from './usage-report'

/**
 * The dashboard's arithmetic.
 *
 * Two invariants carry most of the weight here, and both are written from the
 * claim rather than from the code: every event must land in exactly one bucket
 * (spend that vanishes from a breakdown is the same dishonesty as a total that
 * silently excludes it), and a model bucket must follow the model recorded on
 * the event rather than the one its persona is set to today.
 *
 * Timestamps are built with `new Date(y, m, d, h)` — local, like the day
 * boundaries under test — so the suite does not change answer with TZ.
 */

const at = (y: number, m: number, d: number, h = 12): number => new Date(y, m, d, h).getTime()

let nextId = 0
function event(partial: Partial<UsageEvent> = {}): UsageEvent {
  return {
    id: `u${nextId++}`,
    contactId: 'contact-1',
    timestamp: at(2026, 7, 15),
    source: 'message',
    inputTokens: 100,
    outputTokens: 50,
    costUsd: 0.01,
    ...partial
  }
}

function contact(partial: Partial<Contact> = {}): Contact {
  return {
    id: 'contact-1',
    name: 'Contact',
    personaTemplateId: 'persona-1',
    repoPath: '/Users/steve/code/alpha',
    backendSessionId: null,
    worktreePath: null,
    branch: null,
    isolation: 'shared',
    ...partial
  } as Contact
}

function persona(partial: Partial<PersonaTemplate> = {}): PersonaTemplate {
  return {
    id: 'persona-1',
    name: 'Reviewer',
    avatarColor: '#2a78d6',
    backend: 'claude',
    model: null,
    ...partial
  } as PersonaTemplate
}

describe('filterUsage', () => {
  it('keeps everything when nothing is asked for', () => {
    const events = [event(), event()]
    expect(filterUsage(events)).toHaveLength(2)
  })

  it('includes an event exactly on the lower bound', () => {
    const t = at(2026, 7, 10)
    expect(filterUsage([event({ timestamp: t })], { from: t })).toHaveLength(1)
  })

  it('excludes an event exactly on the upper bound', () => {
    // `to` is exclusive so adjacent windows cannot double-count a turn.
    const t = at(2026, 7, 10)
    expect(filterUsage([event({ timestamp: t })], { to: t })).toHaveLength(0)
  })

  it('isolates a single source', () => {
    // Acceptance check: unsupervised spend has to be separable from the rest.
    const events = [
      event({ source: 'routine' }),
      event({ source: 'message' }),
      event({ source: 'summary' }),
      event({ source: 'routine' })
    ]
    const routines = filterUsage(events, { sources: ['routine'] })
    expect(routines).toHaveLength(2)
    expect(routines.every((e) => e.source === 'routine')).toBe(true)
  })

  it('treats an empty contact list as no contacts, not as all of them', () => {
    expect(filterUsage([event()], { contactIds: [] })).toHaveLength(0)
  })

  it('combines filters conjunctively', () => {
    const events = [
      event({ source: 'routine', contactId: 'a' }),
      event({ source: 'routine', contactId: 'b' }),
      event({ source: 'message', contactId: 'a' })
    ]
    expect(filterUsage(events, { sources: ['routine'], contactIds: ['a'] })).toHaveLength(1)
  })
})

describe('groupUsage', () => {
  it('puts every event in exactly one bucket', () => {
    // The invariant: a breakdown must sum back to the set it came from.
    const events = [
      event({ source: 'message' }),
      event({ source: 'routine' }),
      event({ source: 'summary' }),
      event({ source: 'routine' })
    ]
    const groups = groupUsage(events, bySource())
    expect(groups.reduce((sum, g) => sum + g.events, 0)).toBe(events.length)
  })

  it('carries the unpriced count into each group', () => {
    const groups = groupUsage(
      [event({ source: 'routine', costUsd: null }), event({ source: 'routine', costUsd: 0.05 })],
      bySource()
    )
    expect(groups[0].summary.unpricedEvents).toBe(1)
    expect(groups[0].cost).toBe(0.05)
  })

  it('sorts by cost descending, and puts wholly-unpriced groups last', () => {
    // An unpriced group measures zero on a cost chart but is not zero, so it
    // must not lead the list.
    const groups = groupUsage(
      [
        event({ source: 'message', costUsd: 0.01 }),
        event({ source: 'routine', costUsd: null, inputTokens: 9999 }),
        event({ source: 'summary', costUsd: 0.5 })
      ],
      bySource()
    )
    expect(groups.map((g) => g.key)).toEqual(['summary', 'message', 'routine'])
  })

  it('sorts by tokens when the metric is tokens', () => {
    const groups = groupUsage(
      [
        event({ source: 'message', inputTokens: 10, outputTokens: 0 }),
        event({ source: 'routine', inputTokens: 900, outputTokens: 0 })
      ],
      bySource(),
      'tokens'
    )
    expect(groups.map((g) => g.key)).toEqual(['routine', 'message'])
  })
})

describe('byModel', () => {
  it('attributes each turn to the model that actually ran', () => {
    // One contact, two models across its history. Spend must split by the
    // recorded model — reading the persona's current setting would reprice
    // everything the moment someone switches.
    const groups = groupUsage(
      [
        event({ model: 'gpt-5.5', costUsd: 0.1 }),
        event({ model: 'gpt-5.4-mini', costUsd: 0.01 }),
        event({ model: 'gpt-5.5', costUsd: 0.2 })
      ],
      byModel()
    )
    expect(groups).toHaveLength(2)
    expect(groups.find((g) => g.key === 'gpt-5.5')?.cost).toBeCloseTo(0.3, 10)
    expect(groups.find((g) => g.key === 'gpt-5.4-mini')?.cost).toBeCloseTo(0.01, 10)
  })

  it('gives model-less rows their own bucket', () => {
    // Rows written before migration 0004 carry no model. Folding them into a
    // default would attribute their spend to a model that never ran.
    const groups = groupUsage([event({ model: 'gpt-5.5' }), event({})], byModel())
    expect(groups.map((g) => g.key).sort()).toEqual(['gpt-5.5', UNKNOWN_MODEL])
  })

  it('never merges the unknown bucket into a real model', () => {
    const groups = groupUsage([event({}), event({})], byModel())
    expect(groups).toHaveLength(1)
    expect(groups[0].key).toBe(UNKNOWN_MODEL)
    expect(groups[0].events).toBe(2)
  })
})

describe('byPersona', () => {
  const contacts = [
    contact({ id: 'a', personaTemplateId: 'p1' }),
    contact({ id: 'b', personaTemplateId: 'p2' })
  ]
  const personas = [
    persona({ id: 'p1', name: 'Reviewer', avatarColor: '#111111' }),
    persona({ id: 'p2', name: 'Refactorer', avatarColor: '#222222' })
  ]

  it('groups by the persona behind the contact, carrying its colour', () => {
    const groups = groupUsage(
      [event({ contactId: 'a' }), event({ contactId: 'b' }), event({ contactId: 'a' })],
      byPersona(contacts, personas)
    )
    const reviewer = groups.find((g) => g.key === 'p1')
    expect(reviewer?.label).toBe('Reviewer')
    expect(reviewer?.color).toBe('#111111')
    expect(reviewer?.events).toBe(2)
  })

  it('keeps spend from an unresolvable contact rather than dropping it', () => {
    // Dropping it would make the breakdown quietly disagree with the headline.
    const groups = groupUsage([event({ contactId: 'ghost' })], byPersona(contacts, personas))
    expect(groups).toHaveLength(1)
    expect(groups[0].label).toBe('Unknown persona')
  })

  it('attributes a deleted contact’s spend from the event itself', () => {
    // The contact is gone — there is nothing left to join against — but the
    // persona was stamped on the row when it was written, so the spend is
    // still that persona's.
    const groups = groupUsage(
      [event({ contactId: null, personaTemplateId: 'p1' })],
      byPersona(contacts, personas)
    )
    expect(groups[0].key).toBe('p1')
    expect(groups[0].label).toBe('Reviewer')
  })

  it('prefers the event’s persona over the contact it came from', () => {
    // Only observable if the two disagree, which is the case a re-pointed
    // Contact would create. The event wins: it records what was true when the
    // spend happened, and the join records what is true now.
    const groups = groupUsage(
      [event({ contactId: 'a', personaTemplateId: 'p2' })],
      byPersona(contacts, personas)
    )
    expect(groups[0].key).toBe('p2')
  })

  it('says a persona was deleted, rather than that it is unknown', () => {
    // Two different facts. An id we cannot resolve means the persona itself
    // was deleted; no id at all means a row older than the column.
    const groups = groupUsage(
      [event({ contactId: null, personaTemplateId: 'p-gone' })],
      byPersona(contacts, personas)
    )
    expect(groups[0].label).toBe('Deleted persona')
    expect(groups[0].key).toBe('p-gone')
  })
})

describe('byRepo', () => {
  it('groups by repo path and labels it with the basename', () => {
    const contacts = [
      contact({ id: 'a', repoPath: '/Users/steve/code/alpha' }),
      contact({ id: 'b', repoPath: '/Users/steve/code/beta' })
    ]
    const groups = groupUsage(
      [event({ contactId: 'a' }), event({ contactId: 'b' })],
      byRepo(contacts)
    )
    expect(groups.map((g) => g.label).sort()).toEqual(['alpha', 'beta'])
  })

  it('keys on the full path so two checkouts sharing a name stay apart', () => {
    const contacts = [
      contact({ id: 'a', repoPath: '/one/app' }),
      contact({ id: 'b', repoPath: '/two/app' })
    ]
    const groups = groupUsage(
      [event({ contactId: 'a' }), event({ contactId: 'b' })],
      byRepo(contacts)
    )
    expect(groups).toHaveLength(2)
    expect(groups.every((g) => g.label === 'app')).toBe(true)
  })

  it('still names the repo after the contact is deleted', () => {
    // repoName needs no lookup, so once the path is stamped on the event this
    // dimension is self-contained: a deleted Contact's spend reads under
    // "alpha", not "Unknown repo".
    const groups = groupUsage(
      [event({ contactId: null, repoPath: '/Users/steve/code/alpha' })],
      byRepo([])
    )
    expect(groups[0].label).toBe('alpha')
    expect(groups[0].key).toBe('/Users/steve/code/alpha')
  })

  it('falls back to the contact for a row written before the column existed', () => {
    const groups = groupUsage(
      [event({ contactId: 'a' })],
      byRepo([contact({ id: 'a', repoPath: '/one/legacy' })])
    )
    expect(groups[0].label).toBe('legacy')
  })
})

describe('metricValue', () => {
  it('counts an unpriced turn as zero cost but keeps its tokens', () => {
    const e = event({ costUsd: null, inputTokens: 10, outputTokens: 5 })
    expect(metricValue(e, 'cost')).toBe(0)
    expect(metricValue(e, 'tokens')).toBe(15)
  })
})

describe('bucketByDay', () => {
  it('returns nothing for no events', () => {
    expect(bucketByDay([], bySource())).toEqual([])
  })

  it('fills days with no activity so the axis reads as time', () => {
    const days = bucketByDay(
      [event({ timestamp: at(2026, 7, 10) }), event({ timestamp: at(2026, 7, 13) })],
      bySource()
    )
    expect(days).toHaveLength(4)
    expect(days[1].message).toBeUndefined()
  })

  it('sums the chosen metric per series per day', () => {
    const days = bucketByDay(
      [
        event({ timestamp: at(2026, 7, 10), source: 'routine', costUsd: 0.1 }),
        event({ timestamp: at(2026, 7, 10), source: 'routine', costUsd: 0.2 }),
        event({ timestamp: at(2026, 7, 10), source: 'message', costUsd: 1 })
      ],
      bySource(),
      'cost'
    )
    expect(days).toHaveLength(1)
    expect(days[0].routine).toBeCloseTo(0.3, 10)
    expect(days[0].message).toBe(1)
  })

  it('groups turns from the same day regardless of hour', () => {
    const days = bucketByDay(
      [event({ timestamp: at(2026, 7, 10, 0) }), event({ timestamp: at(2026, 7, 10, 23) })],
      bySource()
    )
    expect(days).toHaveLength(1)
  })

  it('records a day whose bar is short because a turn was unpriced', () => {
    // The bar renders zero for that turn; the count is how the UI can say so.
    const days = bucketByDay(
      [event({ timestamp: at(2026, 7, 10), costUsd: null })],
      bySource(),
      'cost'
    )
    expect(days[0].unpricedEvents).toBe(1)
    expect(days[0].message).toBe(0)
  })
})

describe('dayStart', () => {
  it('collapses every hour of a day to the same instant', () => {
    expect(dayStart(at(2026, 7, 10, 1))).toBe(dayStart(at(2026, 7, 10, 22)))
  })
})

describe('rangeStart', () => {
  it('counts today as one of the days', () => {
    const now = at(2026, 7, 15, 9)
    expect(rangeStart(1, now)).toBe(dayStart(now))
    expect(rangeStart(7, now)).toBe(dayStart(at(2026, 7, 9)))
  })

  it('does not move with the time of day', () => {
    expect(rangeStart(7, at(2026, 7, 15, 0))).toBe(rangeStart(7, at(2026, 7, 15, 23)))
  })
})
