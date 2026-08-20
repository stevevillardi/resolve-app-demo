import { scoreCommand } from './command-palette'

/**
 * Filtering a rail by more than a substring.
 *
 * Every list in the app offered exactly one control: an unranked
 * `includes()` over whichever two fields that list happened to pick. That is
 * enough to find something you can already name and no help at all with the
 * questions a fleet actually raises — "contacts on checkout-service",
 * "personas on Codex", "routines that are paused", "branches nobody merged".
 *
 * Kept out of the components because the renderer Vitest project matches
 * `*.test.ts` only, never `.tsx`, so `lib/` is where renderer logic can be
 * covered at all. Same reason `command-palette.ts` is shaped this way, and the
 * matching here delegates to that file's `scoreCommand` rather than being a
 * sixth implementation of the same idea — `persona-filter.ts` and
 * `repo-filter.ts` already set that precedent.
 */

export interface ListFilter {
  /** What is typed in the search box. */
  query: string
  /**
   * Facet id → the values selected under it. A facet with nothing selected is
   * absent rather than present-and-empty, so "is anything filtered" is a key
   * count and cannot drift from what the chips are showing.
   */
  facets: Record<string, string[]>
}

export const EMPTY_LIST_FILTER: ListFilter = { query: '', facets: {} }

export interface FacetOption {
  value: string
  label: string
}

/**
 * What the chip needs to draw itself: a name and the values on offer.
 *
 * Deliberately separate from the predicate below, because the two are owned by
 * different components. `ListPanel` knows what the options *are* — it has the
 * contacts and personas to derive them from — while each list knows what its
 * own rows *are*, and only the list can say that a routine's repo is its
 * contact's. Fusing them into one generic object would have forced the bar to
 * be generic over a row type it never touches.
 */
export interface FacetSpec {
  id: string
  /** The chip's resting label — "Repo", "Persona". */
  label: string
  options: FacetOption[]
  /**
   * How many options this facet needs before it is worth rendering.
   *
   * Defaults to `FACET_MIN_OPTIONS`, which is right for the facets that
   * *partition by identity* — Repo, Persona, Backend. One repository means
   * every row is in it, so the chip offers a choice that changes nothing.
   *
   * A **state** facet is the exception and needs 1: "Unread" on its own still
   * splits the list into the rows that are and the rows that are not, which is
   * the entire question. Found by looking at the running app — the Chats rail
   * had unread badges on screen and no chip to filter by them, because the
   * blanket rule had silently swallowed a single-option facet that was doing
   * real work.
   */
  minOptions?: number
}

/**
 * Facet id → which of that facet's values an item has.
 *
 * More than one is allowed and matters: a persona carries several skills, so
 * "has this skill" is not a single-value comparison. An item with none matches
 * no selection under that facet.
 */
export type FacetValues<T> = Record<string, (item: T) => string[]>

/**
 * Below this a facet is furniture and is not rendered.
 *
 * A "Repo" chip on a profile with one repository costs a row of vertical space
 * to offer a choice nobody has, and every value it could take is already true
 * of every row. Exactly the argument `PERSONA_FILTER_THRESHOLD` makes about the
 * new-contact flow's search box, and the same number would be wrong here: one
 * option is useless, two is a real decision.
 */
export const FACET_MIN_OPTIONS = 2

export function visibleFacets(specs: FacetSpec[]): FacetSpec[] {
  return specs.filter((spec) => spec.options.length >= (spec.minOptions ?? FACET_MIN_OPTIONS))
}

export function hasQuery(filter: ListFilter): boolean {
  return filter.query.trim().length > 0
}

export function hasFacets(filter: ListFilter): boolean {
  return Object.keys(filter.facets).length > 0
}

export function isFiltering(filter: ListFilter): boolean {
  return hasQuery(filter) || hasFacets(filter)
}

/** How many values are selected across every facet — what the "Clear" chip counts. */
export function activeFacetCount(filter: ListFilter): number {
  return Object.values(filter.facets).reduce((total, values) => total + values.length, 0)
}

export function selectedValues(filter: ListFilter, facetId: string): string[] {
  return filter.facets[facetId] ?? []
}

/**
 * Adds or removes one value, and drops the facet entirely when it empties.
 *
 * The pruning is the load-bearing half. A facet left behind as `{ repo: [] }`
 * reads as "filtered" to `hasFacets` while matching everything, which would
 * show a "Clear" affordance next to a list that is not narrowed — and, worse,
 * would keep hidden groups suppressed (see the conversation rule) on the
 * strength of a filter the user has already switched off.
 */
export function toggleFacetValue(filter: ListFilter, facetId: string, value: string): ListFilter {
  const current = selectedValues(filter, facetId)
  const next = current.includes(value)
    ? current.filter((existing) => existing !== value)
    : [...current, value]

  const facets = { ...filter.facets }
  if (next.length === 0) delete facets[facetId]
  else facets[facetId] = next

  return { ...filter, facets }
}

export function clearFacets(filter: ListFilter): ListFilter {
  return { ...filter, facets: {} }
}

/**
 * Whether an item survives the selected facets.
 *
 * **OR within a facet, AND across facets** — "checkout-service or billing-api,
 * and on Codex". The other reading (AND everywhere) makes selecting a second
 * repository empty the list, which is the opposite of what clicking a second
 * repository means; the one after that (OR everywhere) makes each new chip
 * widen the results, so narrowing becomes impossible.
 *
 * Facets with nothing selected are skipped rather than treated as "match
 * none", which is what makes an untouched filter transparent.
 */
export function matchesFacets<T>(item: T, filter: ListFilter, values: FacetValues<T>): boolean {
  return Object.entries(filter.facets).every(([facetId, selected]) => {
    if (selected.length === 0) return true
    const valuesOf = values[facetId]
    // A selection under a facet this list does not implement matches nothing
    // rather than everything. It can only happen if a filter outlives the
    // section it was set in, and silently ignoring it would show an unfiltered
    // list under a chip claiming otherwise.
    if (!valuesOf) return false
    const owned = valuesOf(item)
    return selected.some((value) => owned.includes(value))
  })
}

/** What the query is matched against. `label` is what the row shows. */
export interface Searchable {
  label: string
  /** The secondary line — a repo path, a description. Also searched. */
  detail?: string
  /** Terms that are not displayed: a backend name, a scope, an alias. */
  keywords?: string[]
}

/**
 * Whether the query matches, using the palette's own scorer.
 *
 * Ranked matching rather than `includes` fixes a specific complaint: typing
 * `billing` found nothing in a list showing "Code Reviewer · billing-api",
 * because a bare substring test over `displayName` had no idea the string had
 * words in it. `scoreCommand` splits on spaces, `·`, `/` and `-`, which is
 * exactly the shape of every name this app derives.
 *
 * The **score is deliberately discarded**. Callers keep their own order —
 * recency in Chats, alphabetical elsewhere — and
 * re-sorting by relevance as someone types would make rows jump under the
 * cursor, and in Chats would silently give ⌥↑/⌥↓ a second definition of order
 * to disagree with.
 */
export function matchesQuery(searchable: Searchable, query: string): boolean {
  const needle = query.trim()
  if (!needle) return true

  return (
    scoreCommand(
      {
        id: searchable.label,
        group: 'Conversations',
        label: searchable.label,
        ...(searchable.detail !== undefined && { detail: searchable.detail }),
        ...(searchable.keywords !== undefined && { keywords: searchable.keywords })
      },
      needle
    ) > 0
  )
}

/**
 * The whole predicate: query AND facets, input order preserved.
 *
 * One function so that "what is in this list" has a single definition per rail,
 * which is what the ⌥↑/⌥↓ binding in `ConversationList` depends on — it walks
 * the rendered order, and the failure mode of a second definition is a shortcut
 * that skips a row the user is looking straight at.
 */
export function filterList<T>(
  items: T[],
  filter: ListFilter,
  values: FacetValues<T>,
  searchableOf: (item: T) => Searchable
): T[] {
  return items.filter(
    (item) => matchesFacets(item, filter, values) && matchesQuery(searchableOf(item), filter.query)
  )
}

/**
 * What an empty list says when a filter emptied it.
 *
 * Every rail already told two nothings apart — "nothing matched" versus "you
 * have not made one yet" — by testing the query string, and named the query in
 * the copy so the reader could see what to delete. Facets break that: a rail
 * can now be empty with the search box blank, and `Nothing matching ""` would
 * be both wrong and unactionable.
 *
 * Three cases because there are three, and the one that matters is the middle
 * one: someone who has forgotten a chip is set needs to be told a filter is
 * responsible, not shown an empty-state that reads like an empty install.
 */
export function noMatchDescription(filter: ListFilter): string {
  const needle = filter.query.trim()
  if (needle && hasFacets(filter)) return `Nothing matching “${needle}” with those filters.`
  if (needle) return `Nothing matching “${needle}”.`
  return 'Nothing matches the filters you have set.'
}
