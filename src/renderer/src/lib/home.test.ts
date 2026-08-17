import { describe, expect, it } from 'vitest'
import {
  authBannerFor,
  dailySpend,
  formatElapsed,
  formatUpcoming,
  missedRuns,
  recentActivity,
  spendWindow,
  upcomingRuns
} from './home'
import type { Contact, PersistedMessage, PersonaTemplate, UsageEvent } from '@/types'

/**
 * The home view's joins and its spend window.
 *
 * Both are the kind of thing that looks obviously right and is quietly wrong at
 * a boundary: a preview whose contact was deleted, a turn that landed exactly
 * on the edge of the window, a price the app does not know.
 */

function contact(id: string, personaTemplateId: string, repoPath: string): Contact {
  return {
    id,
    personaTemplateId,
    repoPath,
    displayName: `${id} · ${repoPath}`,
    backendSessionId: null,
    worktreePath: null,
    branch: null,
    isolation: 'shared',
    repoTrust: null
  }
}

function persona(id: string, name: string): PersonaTemplate {
  return {
    id,
    name,
    avatarColor: '#2a78d6',
    backend: 'claude',
    model: null,
    systemPrompt: '',
    skillIds: [],
    mcpServerIds: [],
    sandbox: 'read_only',
    githubScope: 'read_only'
  }
}

function preview(
  contactId: string,
  content: string,
  timestamp: number,
  role: 'user' | 'assistant' = 'assistant'
): PersistedMessage {
  return { id: `m-${contactId}-${timestamp}`, contactId, role, content, timestamp }
}

function usage(timestamp: number, costUsd: number | null): UsageEvent {
  return {
    id: `u-${timestamp}`,
    contactId: 'c1',
    personaTemplateId: 'p1',
    repoPath: '~/code/app',
    timestamp,
    source: 'message',
    inputTokens: 100,
    outputTokens: 10,
    costUsd,
    model: 'claude-sonnet-5',
    costSource: 'sdk'
  }
}

const CONTACTS = [contact('c1', 'p1', '~/code/checkout-service'), contact('c2', 'p2', '~/code/api')]
const PERSONAS = [persona('p1', 'Code Reviewer'), persona('p2', 'Refactor Buddy')]

describe('recentActivity', () => {
  it('orders newest first regardless of the order it was handed', () => {
    const rows = recentActivity(
      [preview('c1', 'older', 1_000), preview('c2', 'newer', 5_000)],
      CONTACTS,
      PERSONAS,
      10
    )
    expect(rows.map((row) => row.preview)).toEqual(['newer', 'older'])
  })

  it('honours the limit after sorting, not before', () => {
    // Truncating the input order would keep whichever rows arrived first, which
    // is exactly the wrong two.
    const rows = recentActivity(
      [preview('c1', 'old', 1_000), preview('c2', 'new', 9_000)],
      CONTACTS,
      PERSONAS,
      1
    )
    expect(rows.map((row) => row.preview)).toEqual(['new'])
  })

  it('drops a preview whose contact is gone', () => {
    // usage_events survives a deleted contact by design, and messages cascade —
    // but a preview arriving mid-invalidation can still name one. The row's
    // only job is to open a thread, and that thread no longer exists.
    const rows = recentActivity([preview('ghost', 'orphan', 5_000)], CONTACTS, PERSONAS, 10)
    expect(rows).toEqual([])
  })

  it('shows the persona name and the repo name, not the raw path', () => {
    const [row] = recentActivity([preview('c1', 'hello', 5_000)], CONTACTS, PERSONAS, 10)
    expect(row.name).toBe('Code Reviewer')
    expect(row.repo).toBe('checkout-service')
  })

  it('keeps a contact whose persona is missing rather than hiding it', () => {
    // personas.delete refuses while contacts are bound, so this combination
    // means something is wrong. Falling back to the contact's own name says so;
    // dropping the row would hide it.
    const [row] = recentActivity([preview('c1', 'hello', 5_000)], CONTACTS, [], 10)
    expect(row.name).toBe('c1 · ~/code/checkout-service')
  })

  it('flattens the preview to one line', () => {
    const [row] = recentActivity(
      [preview('c1', '# Heading\n\nA second paragraph.', 5_000)],
      CONTACTS,
      PERSONAS,
      10
    )
    expect(row.preview).not.toContain('\n')
  })
})

describe('spendWindow', () => {
  const noon = new Date(2026, 7, 16, 12, 0, 0).getTime()
  const dayMs = 24 * 60 * 60 * 1000

  it('counts today when the window is one day', () => {
    expect(spendWindow([usage(noon, 1)], noon, 1).totalCostUsd).toBe(1)
  })

  it('includes local midnight at the start of the window, and excludes the moment before', () => {
    // The boundary is the whole point: a 7-day window means seven calendar
    // days, and an off-by-one here silently drops or adds a day of spend.
    const start = new Date(2026, 7, 10, 0, 0, 0).getTime()
    const inside = spendWindow([usage(start, 5)], noon, 7)
    const outside = spendWindow([usage(start - 1, 5)], noon, 7)
    expect(inside.totalCostUsd).toBe(5)
    expect(outside.totalCostUsd).toBeNull()
  })

  it('counts turns, including the ones with no price', () => {
    const result = spendWindow([usage(noon, 1), usage(noon, null)], noon, 7)
    expect(result.turns).toBe(2)
    expect(result.unpricedEvents).toBe(1)
  })

  it('leaves an all-unpriced total null rather than zero', () => {
    // `$0.00` would claim the work was free. It was not; the price is unknown.
    const result = spendWindow([usage(noon, null)], noon, 7)
    expect(result.totalCostUsd).toBeNull()
    expect(result.turns).toBe(1)
  })

  it('reports zero turns rather than throwing when nothing is in range', () => {
    const result = spendWindow([usage(noon - 30 * dayMs, 1)], noon, 7)
    expect(result.turns).toBe(0)
    expect(result.totalCostUsd).toBeNull()
  })
})

describe('formatElapsed', () => {
  it('counts seconds under a minute, so a fresh run reads as started', () => {
    expect(formatElapsed(1_000, 1_000)).toBe('0s')
    expect(formatElapsed(1_000, 46_000)).toBe('45s')
  })

  it('switches to whole minutes', () => {
    expect(formatElapsed(0, 60_000)).toBe('1m')
    expect(formatElapsed(0, 59 * 60_000 + 59_000)).toBe('59m')
  })

  it('splits hours and minutes past the hour', () => {
    expect(formatElapsed(0, 60 * 60_000)).toBe('1h 0m')
    expect(formatElapsed(0, 95 * 60_000)).toBe('1h 35m')
  })

  it('never renders a negative age from a clock that moved', () => {
    expect(formatElapsed(10_000, 0)).toBe('0s')
  })
})

describe('upcomingRuns', () => {
  const runs = [
    { routineId: 'b', prompt: 'Second', contactName: null, nextRun: 2_000 },
    { routineId: 'c', prompt: 'Unarmed', contactName: null, nextRun: null },
    { routineId: 'a', prompt: 'First', contactName: 'Reviewer · app', nextRun: 1_000 },
    { routineId: 'd', prompt: 'Fourth', contactName: null, nextRun: 4_000 },
    { routineId: 'e', prompt: 'Third', contactName: null, nextRun: 3_000 }
  ]

  it('sorts soonest first and caps at the limit', () => {
    expect(upcomingRuns(runs, 3).map((run) => run.routineId)).toEqual(['a', 'b', 'e'])
  })

  it('drops routines the engine cannot time rather than showing "never"', () => {
    // Home answers "what happens next"; a row that answers "nothing" belongs
    // to the Routines section.
    expect(upcomingRuns(runs, 10).some((run) => run.routineId === 'c')).toBe(false)
  })
})

describe('formatUpcoming', () => {
  const morning = Date.parse('2026-08-16T09:00:00')

  it('is absolute and local, never a countdown', () => {
    const formatted = formatUpcoming(Date.parse('2026-08-16T14:30:00'), morning)
    expect(formatted).toMatch(/^today /)
    expect(formatted).not.toMatch(/\bin\b|from now/)
  })

  it('reads a midnight rollover as tomorrow', () => {
    const lateNow = Date.parse('2026-08-16T23:59:00')
    expect(formatUpcoming(Date.parse('2026-08-17T00:01:00'), lateNow)).toMatch(/^tomorrow/)
  })

  it('names the day past tomorrow', () => {
    expect(formatUpcoming(Date.parse('2026-08-24T09:00:00'), morning)).toMatch(/Mon/)
  })
})

describe('authBannerFor', () => {
  const healthy = {
    claude: {},
    codex: {},
    github: { tokenState: 'good' as const }
  }

  it('is quiet when everything is fine, and when status has not loaded', () => {
    expect(authBannerFor(healthy)).toBeNull()
    expect(authBannerFor(undefined)).toBeNull()
  })

  it('flags a rejected GitHub token with the reconnect framing', () => {
    const banner = authBannerFor({ ...healthy, github: { tokenState: 'rejected' } })
    expect(banner?.kind).toBe('github')
    expect(banner?.message).toMatch(/reconnect/i)
  })

  it('never mistakes offline for revoked', () => {
    // 'unreachable' means the network failed, not the credential — a banner
    // telling the user to reconnect a good token is the bug this pins.
    expect(authBannerFor({ ...healthy, github: { tokenState: 'unreachable' } })).toBeNull()
  })

  it('surfaces a backend probe failure as a backend banner', () => {
    const banner = authBannerFor({ ...healthy, codex: { error: 'the check timed out' } })
    expect(banner?.kind).toBe('backend')
    expect(banner?.message).toMatch(/timed out/)
  })

  it('ranks a rejected token above a probe failure', () => {
    const banner = authBannerFor({
      claude: { error: 'probe failed' },
      codex: {},
      github: { tokenState: 'rejected' as const }
    })
    expect(banner?.kind).toBe('github')
  })
})

describe('dailySpend', () => {
  const noon2 = Date.parse('2026-08-16T12:00:00')
  const dayMs2 = 86_400_000

  it('returns exactly the window, zero-filled, ending today', () => {
    const points = dailySpend([usage(noon2 - dayMs2, 2), usage(noon2 - dayMs2, 3)], noon2, 7)

    expect(points).toHaveLength(7)
    // Yesterday's two events sum into one bucket; every other day is a real
    // zero rather than a missing bar.
    expect(points[5].cost).toBe(5)
    expect(points.filter((point) => point.cost === 0)).toHaveLength(6)
  })

  it('counts an unpriced event as zero rather than dropping the day', () => {
    const points = dailySpend([usage(noon2, null)], noon2, 7)
    expect(points[6].cost).toBe(0)
  })

  it('excludes events older than the window', () => {
    const points = dailySpend([usage(noon2 - 30 * dayMs2, 9)], noon2, 7)
    expect(points.every((point) => point.cost === 0)).toBe(true)
  })
})

describe('missedRuns', () => {
  function routine(
    id: string,
    contactId: string,
    missedRunCount: number,
    lastMissedAt: number | null
  ): {
    id: string
    contactId: string
    prompt: string
    missedRunCount: number
    lastMissedAt: number | null
  } {
    return { id, contactId, prompt: `prompt-${id}`, missedRunCount, lastMissedAt }
  }

  const CONTACTS = [contact('c1', 'p1', '~/code/app')]

  it('lists only routines currently carrying a miss', () => {
    const rows = missedRuns(
      [routine('r1', 'c1', 0, null), routine('r2', 'c1', 2, 2_000)],
      CONTACTS,
      5
    )

    expect(rows.map((row) => row.routineId)).toEqual(['r2'])
    expect(rows[0].count).toBe(2)
  })

  it('orders by most recent miss and honours the limit', () => {
    const rows = missedRuns(
      [routine('r1', 'c1', 1, 1_000), routine('r2', 'c1', 1, 3_000), routine('r3', 'c1', 1, 2_000)],
      CONTACTS,
      2
    )

    expect(rows.map((row) => row.routineId)).toEqual(['r2', 'r3'])
  })

  it('joins the contact name, and keeps the row when the contact is gone', () => {
    // A missing contact should cascade the routine away entirely, so seeing
    // this combination means something is wrong — hiding the row would be the
    // wrong way to say so.
    const rows = missedRuns(
      [routine('r1', 'c1', 1, 1_000), routine('r2', 'c-gone', 1, 2_000)],
      CONTACTS,
      5
    )

    expect(rows.find((row) => row.routineId === 'r1')?.contactName).toBe('c1 · ~/code/app')
    expect(rows.find((row) => row.routineId === 'r2')?.contactName).toBeNull()
  })

  it('drops a count with no stamp rather than inventing a time', () => {
    expect(missedRuns([routine('r1', 'c1', 3, null)], CONTACTS, 5)).toEqual([])
  })
})
