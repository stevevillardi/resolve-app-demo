import { describe, expect, it } from 'vitest'
import { buildTrayMenu, formatNextRun, QUIT_LABEL, SHOW_LABEL } from './tray-menu'

const NOW = Date.parse('2026-08-16T09:00:00')

describe('buildTrayMenu', () => {
  // The tray is built at startup, before any routine may exist. A section that
  // rendered nothing would read as a broken menu rather than an empty one.
  it('says so when nothing is scheduled, rather than showing an empty section', () => {
    const items = buildTrayMenu([], NOW)

    expect(items.map((item) => item.id)).toEqual(['show', 'header', 'empty', 'quit'])
    expect(items.find((item) => item.id === 'empty')?.label).toBe('No routines scheduled')
  })

  it('always offers show and quit', () => {
    const items = buildTrayMenu([], NOW)

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
      NOW
    )

    // Not an exact string: the time is rendered in the machine's locale, so
    // asserting "09:00" would pass here and fail on a CI box set to 24-hour
    // time somewhere else. What matters is the prompt, the day, and that a
    // time is there at all.
    expect(items[2].label).toMatch(/^Check for new issues — tomorrow \d/)
    // Informational only: clicking a routine row should not fire it by accident.
    expect(items[2].enabled).toBe(false)
  })

  it('truncates a long prompt rather than stretching the menu', () => {
    const items = buildTrayMenu([{ routineId: 'r1', prompt: 'x'.repeat(200), nextRun: NOW }], NOW)

    expect(items[2].label.length).toBeLessThan(70)
    expect(items[2].label).toContain('…')
  })

  it('has something to say about a routine with no computable next run', () => {
    const items = buildTrayMenu([{ routineId: 'r1', prompt: 'Sweep', nextRun: null }], NOW)

    expect(items[2].label).toBe('Sweep — not scheduled')
  })
})

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
