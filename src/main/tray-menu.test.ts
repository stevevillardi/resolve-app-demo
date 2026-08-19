import { describe, expect, it } from 'vitest'
import { buildTrayMenu, formatNextRun, QUIT_LABEL, ROUTINE_ROWS_MAX, SHOW_LABEL } from './tray-menu'

const NOW = Date.parse('2026-08-16T09:00:00')

describe('buildTrayMenu', () => {
  // The tray is built at startup, before any routine may exist. A section that
  // rendered nothing would read as a broken menu rather than an empty one.
  it('says so when nothing is scheduled, rather than showing an empty section', () => {
    const items = buildTrayMenu([], { now: NOW })

    expect(items.map((item) => item.id)).toEqual([
      'show',
      'separator',
      'header',
      'empty',
      'separator',
      'quit'
    ])
    expect(items.find((item) => item.id === 'empty')?.label).toBe('No routines scheduled')
  })

  it('always offers show and quit', () => {
    const items = buildTrayMenu([], { now: NOW })

    expect(items[0]).toEqual({ id: 'show', label: SHOW_LABEL, enabled: true })
    expect(items.at(-1)).toEqual({ id: 'quit', label: QUIT_LABEL, enabled: true })
  })

  it('lists a routine with its prompt and its next fire', () => {
    const items = buildTrayMenu(
      [
        {
          routineId: 'r1',
          prompt: 'Check for new issues',
          nextRun: Date.parse('2026-08-17T09:00:00')
        }
      ],
      { now: NOW }
    )

    // Not an exact string: the time is rendered in the machine's locale, so
    // asserting "09:00" would pass here and fail on a CI box set to 24-hour
    // time somewhere else. What matters is the prompt, the day, and that a
    // time is there at all.
    expect(items[3].label).toMatch(/^Check for new issues — tomorrow \d/)
    // Informational only: clicking a routine row should not fire it by accident.
    expect(items[3].enabled).toBe(false)
  })

  it('truncates a long prompt rather than stretching the menu', () => {
    const items = buildTrayMenu([{ routineId: 'r1', prompt: 'x'.repeat(200), nextRun: NOW }], {
      now: NOW
    })

    expect(items[3].label.length).toBeLessThan(70)
    expect(items[3].label).toContain('…')
  })

  it('has something to say about a routine with no computable next run', () => {
    const items = buildTrayMenu([{ routineId: 'r1', prompt: 'Sweep', nextRun: null }], { now: NOW })

    expect(items[3].label).toBe('Sweep — not scheduled')
  })
  it('caps routine rows and counts the overflow instead of hiding it', () => {
    const many = Array.from({ length: 9 }, (_, i) => ({
      routineId: `r${i}`,
      prompt: `Routine ${i}`,
      nextRun: NOW + i * 60_000
    }))
    const items = buildTrayMenu(many, { now: NOW })

    expect(items.filter((item) => item.id === 'routine')).toHaveLength(ROUTINE_ROWS_MAX)
    expect(items.find((item) => item.id === 'more')?.label).toBe('+ 4 more scheduled')
  })

  it('shows no overflow row at exactly the cap', () => {
    const exact = Array.from({ length: ROUTINE_ROWS_MAX }, (_, i) => ({
      routineId: `r${i}`,
      prompt: `Routine ${i}`,
      nextRun: NOW
    }))
    expect(buildTrayMenu(exact, { now: NOW }).some((item) => item.id === 'more')).toBe(false)
  })

  it('announces running turns, clickably, and only when there are any', () => {
    const idle = buildTrayMenu([], { now: NOW })
    expect(idle.some((item) => item.id === 'running')).toBe(false)

    const one = buildTrayMenu([], { running: [turn()], now: NOW })
    expect(one.find((item) => item.id === 'running')).toEqual({
      id: 'running',
      label: '1 turn running',
      // Enabled on purpose — "something is running" is an invitation to look,
      // and tray.ts maps the click to Show.
      enabled: true
    })

    const three = buildTrayMenu([], { running: [turn(), turn(), turn()], now: NOW })
    expect(three.find((item) => item.id === 'running')?.label).toBe('3 turns running')
  })

  // Phase 25: a count that listed nobody made the tray answer "how many"
  // while dodging "who" — while the scheduled section below it names five
  // routines. Running turns get the same treatment.
  it('names each running turn with its contact, origin, and absolute start', () => {
    const items = buildTrayMenu([], {
      running: [turn({ contactName: 'Refactor Buddy', origin: 'routine', startedAt: NOW })],
      now: NOW
    })
    const row = items.find((item) => item.id === 'run')
    expect(row?.enabled).toBe(true)
    expect(row?.label).toContain('Refactor Buddy — routine since ')
    // Absolute local time, never a countdown — the same no-counting rule as
    // the scheduled section, because a static menu cannot tick.
    expect(row?.label).toMatch(/since \d{1,2}:\d{2}/)
  })

  it('says chat for a typed message', () => {
    const items = buildTrayMenu([], { running: [turn({ origin: 'message' })], now: NOW })
    expect(items.find((item) => item.id === 'run')?.label).toContain('— chat since')
  })

  it('carries a navigate target: the contact thread, or the group for a mention', () => {
    const items = buildTrayMenu([], {
      running: [
        turn({ contactId: 'contact-a', origin: 'routine' }),
        turn({ contactId: 'contact-b', origin: 'mention', groupId: 'group-1' })
      ],
      now: NOW
    })
    const rows = items.filter((item) => item.id === 'run')
    expect(rows[0].target).toEqual({ kind: 'contact', contactId: 'contact-a' })
    expect(rows[1].target).toEqual({ kind: 'group', groupId: 'group-1' })
  })

  it('caps the named rows and counts the overflow', () => {
    const items = buildTrayMenu([], {
      running: Array.from({ length: 7 }, (_, i) => turn({ contactId: `contact-${i}` })),
      now: NOW
    })
    expect(items.filter((item) => item.id === 'run')).toHaveLength(5)
    expect(items.find((item) => item.label === '+ 2 more running')).toBeTruthy()
  })
})

function turn(
  overrides: Partial<import('./tray-menu').TrayRunningTurn> = {}
): import('./tray-menu').TrayRunningTurn {
  return {
    contactId: 'contact-a',
    contactName: 'Code Reviewer',
    origin: 'message',
    groupId: null,
    startedAt: NOW - 60_000,
    ...overrides
  }
}

describe('formatNextRun', () => {
  /**
   * Absolute, never relative. A menu is a static snapshot until something
   * rebuilds it, so "in 12 minutes" starts lying the moment it is drawn while
   * "tomorrow 09:00" stays true however stale it gets.
   */
  it('is an absolute local time, not a countdown', () => {
    const formatted = formatNextRun(Date.parse('2026-08-16T14:30:00'), NOW)

    expect(formatted).toMatch(/^today /)
    expect(formatted).toMatch(/30/)
    // The point of the claim: no elapsed-time phrasing anywhere.
    expect(formatted).not.toMatch(/\bin\b|from now|ago/)
  })

  it('reads a midnight rollover as tomorrow, not as today', () => {
    const lateNow = Date.parse('2026-08-16T23:59:00')
    expect(formatNextRun(Date.parse('2026-08-17T00:01:00'), lateNow)).toMatch(/^tomorrow/)
  })

  it('names the day once it is further out than tomorrow', () => {
    expect(formatNextRun(Date.parse('2026-08-24T09:00:00'), NOW)).toMatch(/Mon/)
  })
})
