import { sessionBoundaries } from './session'
import type { PersistedMessage, UsageEvent } from '@/types'

/**
 * Taking a conversation, and the spend it produced, out of the app (review §G2).
 *
 * The review's phrasing is the design brief: "the honest cost data deserves an
 * exit door". This app goes to some trouble to record what it does not know —
 * a null cost is `—` and never `$0.00`, a partial total wears a `+`, the
 * context meter reads `≈` — and all of that is worth nothing if the only way
 * to get the numbers anywhere else is to retype them off a chart.
 *
 * Pure, and here rather than in main, for the reason the file-header convention
 * in this directory exists: the renderer Vitest project matches `*.test.ts`
 * only, so serialization that lives in a component cannot be tested. Main's
 * side of this is one `showSaveDialog` and one `writeFile` — it never sees a
 * message.
 */

/** ISO-ish local timestamp, which is what a spreadsheet and a human both read. */
function stamp(at: number): string {
  const date = new Date(at)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}`
  )
}

/**
 * A conversation as Markdown.
 *
 * Message content is already Markdown — it is what the model wrote and what
 * `MarkdownMessage` renders — so it is emitted verbatim rather than escaped or
 * re-wrapped. That is the whole reason this format is worth having: the export
 * reads in any editor exactly as it reads in the thread.
 *
 * Speakers are `###` headings rather than blockquotes, because a reply
 * routinely contains its own fenced code and headings, and quoting would
 * require rewriting every line of it — turning a faithful copy into an
 * approximation.
 */
export function threadToMarkdown(input: {
  contactName: string
  personaName: string
  repoPath: string
  exportedAt: number
  messages: PersistedMessage[]
  /** From `usageByMessage()`. Absent entries simply print no cost line. */
  costs?: Map<string, UsageEvent>
}): string {
  const { contactName, personaName, repoPath, exportedAt, messages, costs } = input
  const boundaries = sessionBoundaries(messages)

  const lines: string[] = [
    `# ${contactName}`,
    '',
    `- **Persona:** ${personaName}`,
    `- **Repository:** \`${repoPath}\``,
    `- **Exported:** ${stamp(exportedAt)}`,
    `- **Messages:** ${messages.length}`,
    ''
  ]

  messages.forEach((message, index) => {
    /**
     * The same boundary the thread draws, and it carries the same meaning:
     * everything above it is text the model no longer remembers. An export that
     * dropped it would read as one continuous conversation, which is the
     * misreading the divider exists to prevent.
     */
    if (boundaries.has(index)) {
      lines.push(
        '---',
        '',
        '*New session — nothing above this line was in the model’s memory.*',
        ''
      )
    }

    lines.push(`### ${message.role === 'user' ? 'You' : personaName} · ${stamp(message.timestamp)}`)
    lines.push('')
    lines.push(message.content)
    lines.push('')

    const usage = costs?.get(message.id)
    if (usage) {
      // Deliberately spelled out rather than `—`: a dash is legible on screen
      // beside a tooltip that explains it, and means nothing in a file read
      // somewhere else six months later.
      const cost = usage.costUsd === null ? 'no published price' : `$${usage.costUsd.toFixed(4)}`
      lines.push(
        `*${usage.inputTokens.toLocaleString()} in · ` +
          `${usage.outputTokens.toLocaleString()} out · ${cost}*`,
        ''
      )
    }
  })

  return lines.join('\n')
}

/**
 * One CSV field, quoted only when it has to be.
 *
 * Quoting everything would also be correct and is what most hand-rolled
 * writers do; leaving the simple fields bare keeps the file readable in a
 * terminal, which is half of why anyone exports CSV rather than JSON.
 */
function csvField(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

export const USAGE_CSV_HEADER = [
  'timestamp',
  'contact',
  'persona',
  'repository',
  'source',
  'model',
  'input_tokens',
  'cached_input_tokens',
  'output_tokens',
  'reasoning_output_tokens',
  'cost_usd',
  'cost_source',
  'session_id',
  'routine_id'
] as const

/**
 * Usage events as CSV.
 *
 * **An unknown cost is an empty cell, never `0`.** This is the one rule in the
 * file that matters more than the format: the whole point of exporting is that
 * someone will sum the column, and a zero would be summed as free rather than
 * skipped as unknown. It is the same distinction `formatCost` makes with `—`
 * and `aggregateUsage` makes with `unpricedEvents`, carried across the boundary
 * where nothing in this app can explain it any more.
 *
 * Ids that resolve to a name are exported as the name, with the raw id left out
 * — a spreadsheet of UUIDs is a worse artefact than one that says "Code
 * Reviewer", and a contact that has since been deleted keeps its spend but
 * loses its name, which the empty cell states accurately.
 */
export function usageToCsv(
  events: UsageEvent[],
  names: {
    contact: (id: string | null) => string | null
    persona: (id: string | undefined) => string | null
  }
): string {
  const rows = events.map((event) =>
    [
      stamp(event.timestamp),
      names.contact(event.contactId) ?? '',
      names.persona(event.personaTemplateId) ?? '',
      event.repoPath ?? '',
      event.source,
      event.model ?? '',
      String(event.inputTokens),
      event.cachedInputTokens === undefined ? '' : String(event.cachedInputTokens),
      String(event.outputTokens),
      event.reasoningOutputTokens === undefined ? '' : String(event.reasoningOutputTokens),
      // The load-bearing line. See above.
      event.costUsd === null ? '' : event.costUsd.toFixed(6),
      event.costSource ?? '',
      event.sessionId ?? '',
      event.routineId ?? ''
    ]
      .map(csvField)
      .join(',')
  )

  return [USAGE_CSV_HEADER.join(','), ...rows].join('\n')
}

/**
 * A filename a save dialog can open with.
 *
 * Slugged rather than passed through: a contact can be called anything, and
 * `Code Reviewer · my-app` contains a character that is legal in a macOS
 * filename, illegal on Windows, and confusing in a shell on both.
 */
export function exportFileName(base: string, extension: string, at: number): string {
  const slug =
    base
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'export'
  const date = new Date(at)
  const pad = (value: number): string => String(value).padStart(2, '0')
  const day = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`
  return `${slug}-${day}.${extension}`
}
