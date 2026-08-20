import { describe, expect, it } from 'vitest'
import {
  formatDaySeparator,
  formatListTimestamp,
  formatRelative,
  formatTime,
  isSameDay,
  groupName,
  previewLine,
  repoName
} from './format'

/**
 * Date formatting is locale- and timezone-sensitive, so these assert on the
 * branching (today vs this week vs older) rather than on exact rendered
 * strings, which would only encode the CI box's locale.
 *
 * Every function takes an injectable `now`, which is what makes the boundaries
 * testable at all.
 */

const MINUTE = 60_000
const HOUR = 3_600_000
const DAY = 86_400_000

/** Midday, to keep arithmetic clear of DST and midnight edges. */
const NOW = new Date(2026, 7, 16, 12, 0, 0).getTime()
const startOfToday = new Date(NOW).setHours(0, 0, 0, 0)

describe('formatTime', () => {
  it('renders 24-hour clock time', () => {
    expect(formatTime(new Date(2026, 7, 16, 9, 24).getTime())).toMatch(/^\d{2}:\d{2}$/)
  })

  it('does not roll over to 12-hour for afternoon times', () => {
    const afternoon = formatTime(new Date(2026, 7, 16, 21, 5).getTime())
    expect(afternoon).toMatch(/^21:05$/)
  })
})

describe('formatListTimestamp', () => {
  it('shows clock time for today', () => {
    expect(formatListTimestamp(NOW - 2 * HOUR, NOW)).toMatch(/^\d{2}:\d{2}$/)
  })

  it('shows clock time at the first instant of today', () => {
    expect(formatListTimestamp(startOfToday, NOW)).toMatch(/^\d{2}:\d{2}$/)
  })

  it('shows a weekday for earlier this week', () => {
    const result = formatListTimestamp(startOfToday - 2 * DAY, NOW)
    expect(result).not.toMatch(/^\d{2}:\d{2}$/)
    expect(result.length).toBeLessThanOrEqual(4)
  })

  it('shows a date beyond the last week', () => {
    // Distinct from the weekday branch — "Sun" 8 days ago is ambiguous.
    const result = formatListTimestamp(startOfToday - 30 * DAY, NOW)
    expect(result).toMatch(/\d/)
  })

  it('switches from weekday to date at the 7-day boundary', () => {
    const withinWeek = formatListTimestamp(startOfToday - 6 * DAY, NOW)
    const beyondWeek = formatListTimestamp(startOfToday - 7 * DAY, NOW)
    expect(withinWeek).not.toBe(beyondWeek)
    expect(beyondWeek).toMatch(/\d/)
  })
})

describe('formatDaySeparator', () => {
  it('labels today', () => {
    expect(formatDaySeparator(NOW - HOUR, NOW)).toBe('Today')
  })

  it('labels the first instant of today', () => {
    expect(formatDaySeparator(startOfToday, NOW)).toBe('Today')
  })

  it('labels yesterday', () => {
    expect(formatDaySeparator(startOfToday - HOUR, NOW)).toBe('Yesterday')
  })

  it('spells out anything older', () => {
    const result = formatDaySeparator(startOfToday - 3 * DAY, NOW)
    expect(result).not.toBe('Today')
    expect(result).not.toBe('Yesterday')
    expect(result).toMatch(/\d/)
  })
})

describe('isSameDay', () => {
  it('is true across hours of one day', () => {
    expect(
      isSameDay(new Date(2026, 7, 16, 0, 1).getTime(), new Date(2026, 7, 16, 23, 59).getTime())
    ).toBe(true)
  })

  it('is false one minute either side of midnight', () => {
    expect(
      isSameDay(new Date(2026, 7, 16, 23, 59).getTime(), new Date(2026, 7, 17, 0, 1).getTime())
    ).toBe(false)
  })

  it('is false for the same day in different months and years', () => {
    // Guards the classic bug of comparing only the day-of-month.
    expect(isSameDay(new Date(2026, 7, 16).getTime(), new Date(2026, 8, 16).getTime())).toBe(false)
    expect(isSameDay(new Date(2025, 7, 16).getTime(), new Date(2026, 7, 16).getTime())).toBe(false)
  })
})

describe('formatRelative', () => {
  it.each([
    [0, 'just now'],
    [29_000, 'just now'],
    // Rounds to the nearest minute, so 30s is already "1m ago", not "just now".
    [30_000, '1m ago'],
    [5 * MINUTE, '5m ago'],
    [59 * MINUTE, '59m ago'],
    [2 * HOUR, '2h ago'],
    [DAY, 'yesterday'],
    [3 * DAY, '3d ago']
  ])('renders %ims ago as "%s"', (delta, expected) => {
    expect(formatRelative(NOW - delta, NOW)).toBe(expected)
  })

  it('uses the singular "yesterday" rather than "1d ago"', () => {
    expect(formatRelative(NOW - DAY, NOW)).toBe('yesterday')
  })
})

describe('repoName', () => {
  it('takes the last path segment', () => {
    expect(repoName('/Users/steve/Documents/GitHub/resolve-app-demo')).toBe('resolve-app-demo')
  })

  it('ignores a trailing slash', () => {
    expect(repoName('/Users/steve/projects/api/')).toBe('api')
  })

  it('passes through a bare name', () => {
    expect(repoName('resolve-app-demo')).toBe('resolve-app-demo')
  })

  it('falls back to the input rather than returning empty', () => {
    expect(repoName('/')).toBe('/')
    expect(repoName('')).toBe('')
  })
})

describe('previewLine', () => {
  it('takes the first non-empty line', () => {
    expect(previewLine('\n\n  Second line is the first real one  \nthird')).toBe(
      'Second line is the first real one'
    )
  })

  it('skips a leading code fence', () => {
    // Otherwise every code-heavy reply previews as "```ts".
    expect(previewLine('```ts\nconst x = 1\n```')).toBe('const x = 1')
  })

  it.each([
    ['## Heading text', 'Heading text'],
    ['- bullet item', 'bullet item'],
    ['* bullet item', 'bullet item'],
    ['run `npm test` now', 'run npm test now'],
    ['this is **bold** text', 'this is bold text'],
    ['this is *italic* text', 'this is italic text'],
    ['see [the docs](https://example.com)', 'see the docs']
  ])('strips markdown from %s', (input, expected) => {
    expect(previewLine(input)).toBe(expected)
  })

  it('returns empty for empty or whitespace-only content', () => {
    expect(previewLine('')).toBe('')
    expect(previewLine('\n  \n')).toBe('')
  })
})

/**
 * A group's displayed name.
 *
 * The fallback is the whole function: a group's name is derived from its
 * repository path until someone overrides it. Getting the null case wrong would
 * rename every group in an upgraded profile to nothing at once.
 */
describe('groupName', () => {
  it('uses the stored name when there is one', () => {
    expect(groupName({ name: 'Checkout', repoPath: '/Users/dev/my-app' })).toBe('Checkout')
  })

  it('falls back to the repository name when there is not', () => {
    expect(groupName({ name: null, repoPath: '/Users/dev/my-app' })).toBe('my-app')
  })

  it('trims the stored name', () => {
    expect(groupName({ name: '  Checkout  ', repoPath: '/Users/dev/my-app' })).toBe('Checkout')
  })

  /**
   * `groups.rename` refuses this at the Zod boundary, so it can only arrive on
   * a row written before that existed — and a blank sidebar row is a worse
   * failure than an unhelpful one, because there is nothing left to click.
   */
  it('reads an all-whitespace name as no name at all', () => {
    expect(groupName({ name: '   ', repoPath: '/Users/dev/my-app' })).toBe('my-app')
    expect(groupName({ name: '', repoPath: '/Users/dev/my-app' })).toBe('my-app')
  })

  // A name that happens to match the repository's is still an override, and
  // renders the same either way — this is what lets the rename dialog collapse
  // that case to null without anything on screen changing.
  it('renders the same whether the name is stored or derived', () => {
    expect(groupName({ name: 'my-app', repoPath: '/Users/dev/my-app' })).toBe(
      groupName({ name: null, repoPath: '/Users/dev/my-app' })
    )
  })
})
