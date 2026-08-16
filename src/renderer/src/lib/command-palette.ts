/**
 * Ranking and grouping for the command palette.
 *
 * Kept out of the component on purpose: the renderer Vitest project matches
 * `src/renderer/**\/*.test.ts` only — `.tsx` is not matched and there is no
 * @testing-library/react — so pure functions in `lib/` are the only renderer
 * logic that can actually be covered. The palette's matching rules are the one
 * genuinely non-obvious thing about it, which makes them worth testing and the
 * markup around them not.
 */

/** The order groups appear in. Conversations first: it is what you reach for. */
export const COMMAND_GROUPS = [
  'Conversations',
  'Personas',
  'Skills',
  'Routines',
  'Go to',
  'Actions'
] as const

export type CommandGroup = (typeof COMMAND_GROUPS)[number]

export interface CommandItem {
  id: string
  group: CommandGroup
  /** What the user reads and types against. */
  label: string
  /** Secondary line — a repo path, a description. Also searched. */
  detail?: string
  /** Extra search terms that are not displayed, e.g. an alias. */
  keywords?: string[]
}

export interface CommandSection {
  group: CommandGroup
  items: CommandItem[]
}

/**
 * Score one item against a query. Higher is better; 0 means no match.
 *
 * Three tiers rather than a fuzzy distance: a prefix hit on the label is what
 * the user almost always means, a word-start hit inside the label is next, and
 * anything found only in the detail or keywords ranks last. Subsequence
 * matching is deliberately not implemented — with a few dozen items it produces
 * more surprising hits than useful ones.
 */
export function scoreCommand(item: CommandItem, query: string): number {
  const needle = query.trim().toLowerCase()
  if (!needle) return 1

  const label = item.label.toLowerCase()
  if (label.startsWith(needle)) return 100
  // Word-start: "buddy" should find "Refactor Buddy", "reviewer" find "Code Reviewer".
  if (label.split(/[\s·/-]+/).some((word) => word.startsWith(needle))) return 80
  if (label.includes(needle)) return 60

  const haystack = [item.detail ?? '', ...(item.keywords ?? [])].join(' ').toLowerCase()
  if (haystack.includes(needle)) return 30

  return 0
}

/**
 * Filter to matching items, order them within each group, and drop empty
 * groups so the palette never renders a heading with nothing under it.
 *
 * Ties keep their input order — the caller supplies conversations already
 * sorted by recency, and re-sorting alphabetically on a tie would throw that
 * away for no gain.
 */
export function buildCommandSections(items: CommandItem[], query: string): CommandSection[] {
  const scored = items
    .map((item, index) => ({ item, index, score: scoreCommand(item, query) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)

  return COMMAND_GROUPS.map((group) => ({
    group,
    items: scored.filter((entry) => entry.item.group === group).map((entry) => entry.item)
  })).filter((section) => section.items.length > 0)
}
