import { describe, expect, it } from 'vitest'
import { exportFileName, threadToMarkdown, usageToCsv, USAGE_CSV_HEADER } from './export'
import type { PersistedMessage, UsageEvent } from '@/types'

/**
 * The export formats.
 *
 * One rule here outranks everything about layout: an unknown cost must not
 * leave this app as a zero. Inside the app a null is `—` next to a tooltip
 * explaining it; in a spreadsheet there is nothing left to explain it, and
 * someone will sum the column. A zero would be summed as free.
 */

const AT = new Date('2026-08-18T14:32:00').getTime()

function message(partial: Partial<PersistedMessage> & { id: string }): PersistedMessage {
  return {
    contactId: 'contact-1',
    role: 'user',
    content: 'hello',
    timestamp: AT,
    ...partial
  }
}

function event(partial: Partial<UsageEvent> = {}): UsageEvent {
  return {
    id: 'u1',
    contactId: 'contact-1',
    timestamp: AT,
    source: 'message',
    inputTokens: 1200,
    outputTokens: 340,
    costUsd: 0.0123,
    ...partial
  }
}

const NAMES = {
  contact: (id: string | null) => (id === 'contact-1' ? 'Code Reviewer · my-app' : null),
  persona: (id: string | undefined) => (id === 'persona-1' ? 'Code Reviewer' : null)
}

describe('threadToMarkdown', () => {
  const base = {
    contactName: 'Code Reviewer · my-app',
    personaName: 'Code Reviewer',
    repoPath: '/Users/dev/my-app',
    exportedAt: AT
  }

  it('carries the conversation, in order, under a header', () => {
    const out = threadToMarkdown({
      ...base,
      messages: [
        message({ id: 'm1', role: 'user', content: 'Is the retry safe?' }),
        message({ id: 'm2', role: 'assistant', content: 'No — it can double-charge.' })
      ]
    })

    expect(out).toContain('# Code Reviewer · my-app')
    expect(out).toContain('`/Users/dev/my-app`')
    expect(out).toContain('### You · 2026-08-18 14:32')
    expect(out).toContain('### Code Reviewer · 2026-08-18 14:32')
    expect(out.indexOf('Is the retry safe?')).toBeLessThan(out.indexOf('can double-charge'))
  })

  /**
   * Content is emitted verbatim, and this is the case that decides the format.
   * A reply routinely contains its own fenced code and headings, so quoting or
   * escaping it would mean rewriting every line — turning a faithful copy into
   * an approximation. It is why speakers are headings rather than blockquotes.
   */
  it('leaves markdown in a reply exactly as the model wrote it', () => {
    const content = '## Findings\n\n```ts\nconst x = 1\n```\n\n- one\n- two'
    const out = threadToMarkdown({
      ...base,
      messages: [message({ id: 'm1', role: 'assistant', content })]
    })
    expect(out).toContain(content)
  })

  // The same boundary the thread draws, with the same meaning. An export that
  // dropped it would read as one continuous conversation.
  it('marks where the model stopped remembering', () => {
    const out = threadToMarkdown({
      ...base,
      messages: [
        message({ id: 'm1', sessionId: 's1' }),
        message({ id: 'm2', sessionId: 's2', content: 'after' })
      ]
    })
    expect(out).toContain('New session')
  })

  it('draws no divider through a thread that has only ever had one session', () => {
    const out = threadToMarkdown({
      ...base,
      messages: [message({ id: 'm1', sessionId: 's1' }), message({ id: 'm2', sessionId: 's1' })]
    })
    expect(out).not.toContain('New session')
  })

  it('includes what a turn cost when there is a usage row for it', () => {
    const out = threadToMarkdown({
      ...base,
      messages: [message({ id: 'm2', role: 'assistant' })],
      costs: new Map([['m2', event({ costUsd: 0.42 })]])
    })
    expect(out).toContain('1,200 in · 340 out · $0.4200')
  })

  /**
   * Spelled out rather than an em dash. On screen a `—` sits next to a tooltip
   * that explains it; in a file opened somewhere else six months later it is
   * indistinguishable from a formatting artefact.
   */
  it('says an unpriced turn has no published price rather than showing a dash or a zero', () => {
    const out = threadToMarkdown({
      ...base,
      messages: [message({ id: 'm2', role: 'assistant' })],
      costs: new Map([['m2', event({ costUsd: null })]])
    })
    expect(out).toContain('no published price')
    expect(out).not.toContain('$0.0000')
  })

  it('omits the cost line entirely for a message with no usage row', () => {
    const out = threadToMarkdown({
      ...base,
      messages: [message({ id: 'm2', role: 'assistant' })],
      costs: new Map()
    })
    expect(out).not.toContain(' in · ')
  })

  it('produces a header and nothing else for an empty thread', () => {
    const out = threadToMarkdown({ ...base, messages: [] })
    expect(out).toContain('**Messages:** 0')
    expect(out).not.toContain('###')
  })
})

describe('usageToCsv', () => {
  it('writes the header even with no rows', () => {
    expect(usageToCsv([], NAMES)).toBe(USAGE_CSV_HEADER.join(','))
  })

  it('resolves ids to the names a reader can use', () => {
    const csv = usageToCsv([event({ personaTemplateId: 'persona-1' })], NAMES)
    expect(csv).toContain('Code Reviewer · my-app')
    expect(csv.split('\n')[1]).toContain('Code Reviewer')
  })

  /**
   * The rule the whole file is built around. Somebody will sum this column.
   */
  it('leaves an unknown cost empty, never zero', () => {
    const [, row] = usageToCsv([event({ costUsd: null })], NAMES).split('\n')
    const cost = row.split(',')[USAGE_CSV_HEADER.indexOf('cost_usd')]
    expect(cost).toBe('')

    // And a real zero is still a zero — the two must not collapse together.
    const [, freeRow] = usageToCsv([event({ costUsd: 0 })], NAMES).split('\n')
    expect(freeRow.split(',')[USAGE_CSV_HEADER.indexOf('cost_usd')]).toBe('0.000000')
  })

  // Spend outlives its contact, so a deleted one is a null id. An
  // empty cell states that accurately; inventing a placeholder would not.
  it('leaves the contact empty for spend whose contact is gone', () => {
    const [, row] = usageToCsv([event({ contactId: null })], NAMES).split('\n')
    expect(row.split(',')[USAGE_CSV_HEADER.indexOf('contact')]).toBe('')
  })

  /**
   * A contact can be called anything, and the default shape is
   * `Code Reviewer · my-app` — no comma, but a rename is one keystroke away
   * from putting one there, and an unquoted comma silently shifts every
   * following column by one.
   */
  it('quotes a field containing a comma, a quote, or a newline', () => {
    const csv = usageToCsv([event()], {
      contact: () => 'Reviewer, "senior"\nnight shift',
      persona: () => null
    })
    expect(csv).toContain('"Reviewer, ""senior""\nnight shift"')
  })

  it('leaves an ordinary field unquoted, so the file reads in a terminal', () => {
    expect(usageToCsv([event({ model: 'claude-opus-5' })], NAMES)).toContain(',claude-opus-5,')
  })

  it('writes one row per event', () => {
    expect(usageToCsv([event(), event(), event()], NAMES).split('\n')).toHaveLength(4)
  })
})

describe('exportFileName', () => {
  it('slugs a name that is legal here and illegal elsewhere', () => {
    // `·` is fine in a macOS filename, illegal on Windows, and awkward in any
    // shell — and this app puts one in every derived contact name.
    expect(exportFileName('Code Reviewer · my-app', 'md', AT)).toBe(
      'code-reviewer-my-app-20260818.md'
    )
  })

  it('falls back rather than producing a file called nothing', () => {
    expect(exportFileName('···', 'csv', AT)).toBe('export-20260818.csv')
  })

  it('caps a very long name', () => {
    const name = exportFileName('x'.repeat(200), 'md', AT)
    expect(name.length).toBeLessThan(80)
  })
})
