import { describe, expect, it } from 'vitest'
import {
  EMPTY_LIST_FILTER,
  activeFacetCount,
  clearFacets,
  filterList,
  hasFacets,
  hasQuery,
  isFiltering,
  matchesFacets,
  matchesQuery,
  noMatchDescription,
  selectedValues,
  toggleFacetValue,
  visibleFacets,
  type FacetSpec,
  type FacetValues,
  type ListFilter
} from './list-filter'

interface Row {
  name: string
  repo: string
  backend: string
}

const ROWS: Row[] = [
  { name: 'Code Reviewer · checkout-service', repo: 'checkout-service', backend: 'claude' },
  { name: 'Code Reviewer · billing-api', repo: 'billing-api', backend: 'claude' },
  { name: 'Refactor Buddy · checkout-service', repo: 'checkout-service', backend: 'codex' }
]

const REPO_FACET: FacetSpec = {
  id: 'repo',
  label: 'Repo',
  options: [
    { value: 'checkout-service', label: 'checkout-service' },
    { value: 'billing-api', label: 'billing-api' }
  ]
}

const BACKEND_FACET: FacetSpec = {
  id: 'backend',
  label: 'Backend',
  options: [
    { value: 'claude', label: 'Claude' },
    { value: 'codex', label: 'Codex' }
  ]
}

const DEFS: FacetValues<Row> = {
  repo: (row) => [row.repo],
  backend: (row) => [row.backend]
}

function withFacets(facets: ListFilter['facets']): ListFilter {
  return { query: '', facets }
}

const names = (rows: Row[]): string[] => rows.map((row) => row.name)

describe('matchesFacets', () => {
  it('lets everything through when nothing is selected', () => {
    expect(ROWS.every((row) => matchesFacets(row, EMPTY_LIST_FILTER, DEFS))).toBe(true)
  })

  it('ORs within one facet — a second repo widens, never empties', () => {
    // The reading that makes clicking a second repository mean what it looks
    // like it means. AND here would return nothing, since no row is in two
    // repositories at once.
    const filter = withFacets({ repo: ['checkout-service', 'billing-api'] })
    expect(ROWS.filter((row) => matchesFacets(row, filter, DEFS))).toHaveLength(3)
  })

  it('ANDs across facets — each new kind of chip narrows', () => {
    const filter = withFacets({ repo: ['checkout-service'], backend: ['codex'] })
    const kept = ROWS.filter((row) => matchesFacets(row, filter, DEFS))

    expect(names(kept)).toEqual(['Refactor Buddy · checkout-service'])
  })

  it("excludes an item that has none of a facet's selected values", () => {
    const filter = withFacets({ backend: ['codex'] })
    expect(names(ROWS.filter((row) => matchesFacets(row, filter, DEFS)))).toEqual([
      'Refactor Buddy · checkout-service'
    ])
  })

  it('matches an item that carries several values for one facet', () => {
    // A persona attaches several skills, so "does this item have the selected
    // value" is not a single-value comparison.
    const multi: FacetValues<{ skills: string[] }> = { skill: (item) => item.skills }
    const item = { skills: ['ts', 'sec'] }

    expect(matchesFacets(item, withFacets({ skill: ['sec'] }), multi)).toBe(true)
    expect(matchesFacets({ skills: ['ts'] }, withFacets({ skill: ['sec'] }), multi)).toBe(false)
  })

  /**
   * A selection under a facet the list does not implement matches nothing, not
   * everything.
   *
   * It can only arise if a filter outlives the section it was set in — which
   * `showIn` makes possible by design, since it sets a filter on a section it
   * is not currently on. Ignoring the unknown facet would draw an unfiltered
   * list underneath a chip claiming it was filtered, which is the one outcome
   * worse than showing nothing.
   */
  it('matches nothing under a facet this list has no values for', () => {
    const filter = withFacets({ nonexistent: ['whatever'] })
    expect(ROWS.some((row) => matchesFacets(row, filter, DEFS))).toBe(false)
  })
})

describe('matchesQuery', () => {
  it('finds a word inside a derived name', () => {
    // The complaint this replaces: a bare `includes` over displayName could not
    // find "billing" in "Code Reviewer · billing-api" by word, only by
    // substring — and could not rank it at all.
    expect(matchesQuery({ label: 'Code Reviewer · billing-api' }, 'billing')).toBe(true)
  })

  it('searches the detail line as well as the label', () => {
    expect(
      matchesQuery({ label: 'Code Reviewer', detail: '/Users/dev/billing-api' }, 'billing')
    ).toBe(true)
  })

  it('searches keywords the row does not display', () => {
    expect(matchesQuery({ label: 'Code Reviewer', keywords: ['codex'] }, 'codex')).toBe(true)
  })

  it('matches everything when the query is blank or whitespace', () => {
    expect(matchesQuery({ label: 'anything' }, '')).toBe(true)
    expect(matchesQuery({ label: 'anything' }, '   ')).toBe(true)
  })

  it('rejects a genuine miss', () => {
    expect(matchesQuery({ label: 'Code Reviewer' }, 'zzznope')).toBe(false)
  })
})

describe('filterList', () => {
  const searchable = (row: Row): { label: string; keywords: string[] } => ({
    label: row.name,
    keywords: [row.backend]
  })

  it('applies query and facets together', () => {
    const filter: ListFilter = { query: 'reviewer', facets: { repo: ['billing-api'] } }

    expect(names(filterList(ROWS, filter, DEFS, searchable))).toEqual([
      'Code Reviewer · billing-api'
    ])
  })

  /**
   * The property `ConversationList` depends on. It walks the rendered order
   * with ⌥↑/⌥↓, having already sorted by recency (Phase 20), and re-sorting by
   * relevance here would both make rows jump as someone types and give that
   * binding a second definition of order to disagree with.
   */
  it('preserves input order rather than sorting by relevance', () => {
    // Built so the two readings genuinely disagree: `scoreCommand` gives the
    // second row a label *prefix* hit (100) and the first only a word-start
    // hit (80), so anything sorting by score would swap them. Input order is
    // the assertion.
    const rows: Row[] = [
      { name: 'Refactor Buddy · code-mod', repo: 'billing-api', backend: 'claude' },
      { name: 'Code Reviewer · billing-api', repo: 'billing-api', backend: 'claude' }
    ]
    const filter: ListFilter = { query: 'code', facets: {} }

    expect(names(filterList(rows, filter, DEFS, searchable))).toEqual([
      'Refactor Buddy · code-mod',
      'Code Reviewer · billing-api'
    ])
  })

  it('returns everything for an untouched filter', () => {
    expect(filterList(ROWS, EMPTY_LIST_FILTER, DEFS, searchable)).toHaveLength(3)
  })
})

describe('toggleFacetValue', () => {
  it('adds a value', () => {
    const next = toggleFacetValue(EMPTY_LIST_FILTER, 'repo', 'billing-api')
    expect(selectedValues(next, 'repo')).toEqual(['billing-api'])
  })

  it('removes a value that was already selected', () => {
    const on = toggleFacetValue(EMPTY_LIST_FILTER, 'repo', 'billing-api')
    const off = toggleFacetValue(on, 'repo', 'billing-api')
    expect(selectedValues(off, 'repo')).toEqual([])
  })

  /**
   * The pruning claim, and the reason it is not cosmetic. A facet left as an
   * empty array reads as "filtered" to `hasFacets` while matching everything —
   * so the rail would offer to clear a filter that is not there, and the
   * conversation list would keep hidden groups suppressed on the strength of
   * a filter the user has just switched off.
   */
  it('drops the facet entirely once its last value is removed', () => {
    const on = toggleFacetValue(EMPTY_LIST_FILTER, 'repo', 'billing-api')
    const off = toggleFacetValue(on, 'repo', 'billing-api')

    expect('repo' in off.facets).toBe(false)
    expect(hasFacets(off)).toBe(false)
  })

  it('leaves other facets alone', () => {
    const both = toggleFacetValue(
      toggleFacetValue(EMPTY_LIST_FILTER, 'repo', 'billing-api'),
      'backend',
      'codex'
    )
    const next = toggleFacetValue(both, 'repo', 'billing-api')

    expect(next.facets).toEqual({ backend: ['codex'] })
  })

  it('does not mutate the filter it was given', () => {
    const before = withFacets({ repo: ['billing-api'] })
    toggleFacetValue(before, 'repo', 'checkout-service')
    expect(before.facets).toEqual({ repo: ['billing-api'] })
  })

  it('keeps the query across a facet change', () => {
    const next = toggleFacetValue({ query: 'reviewer', facets: {} }, 'repo', 'billing-api')
    expect(next.query).toBe('reviewer')
  })
})

describe('visibleFacets', () => {
  it('hides a facet with only one possible value', () => {
    // A "Repo" chip on a one-repository profile costs a row of space to offer a
    // choice nobody has — the argument PERSONA_FILTER_THRESHOLD already makes.
    const single: FacetSpec = { ...REPO_FACET, options: [REPO_FACET.options[0]!] }
    expect(visibleFacets([single, BACKEND_FACET]).map((spec) => spec.id)).toEqual(['backend'])
  })

  it('hides a facet with no values at all', () => {
    expect(visibleFacets([{ ...REPO_FACET, options: [] }])).toEqual([])
  })

  it('shows a facet as soon as there is a real decision', () => {
    expect(visibleFacets([REPO_FACET, BACKEND_FACET]).map((spec) => spec.id)).toEqual([
      'repo',
      'backend'
    ])
  })
})

describe('hasQuery / hasFacets / isFiltering / activeFacetCount', () => {
  it('reads whitespace as no query', () => {
    // `esc` clears the box to '', but a stray space must not count as filtering
    // — the conversation list keys the hidden-group rule off this.
    expect(hasQuery({ query: '   ', facets: {} })).toBe(false)
    expect(hasQuery({ query: ' a ', facets: {} })).toBe(true)
  })

  it('separates the two kinds of filtering', () => {
    const queryOnly: ListFilter = { query: 'a', facets: {} }
    const facetOnly = withFacets({ repo: ['billing-api'] })

    expect([hasQuery(queryOnly), hasFacets(queryOnly)]).toEqual([true, false])
    expect([hasQuery(facetOnly), hasFacets(facetOnly)]).toEqual([false, true])
    expect([isFiltering(queryOnly), isFiltering(facetOnly)]).toEqual([true, true])
    expect(isFiltering(EMPTY_LIST_FILTER)).toBe(false)
  })

  it('counts every selected value, across facets', () => {
    expect(activeFacetCount(EMPTY_LIST_FILTER)).toBe(0)
    expect(activeFacetCount(withFacets({ repo: ['a', 'b'], backend: ['codex'] }))).toBe(3)
  })
})

describe('clearFacets', () => {
  it('drops every facet but keeps the query', () => {
    const cleared = clearFacets({ query: 'reviewer', facets: { repo: ['a'], backend: ['codex'] } })
    expect(cleared).toEqual({ query: 'reviewer', facets: {} })
  })
})

describe('noMatchDescription', () => {
  it('names the query when that is what narrowed the list', () => {
    expect(noMatchDescription({ query: 'billing', facets: {} })).toBe('Nothing matching “billing”.')
  })

  /**
   * The case facets introduced. A rail can now be empty with the search box
   * blank, and someone who has forgotten a chip is set needs to be told a
   * filter is responsible — otherwise this reads exactly like an empty install
   * and invites them to create something they already have.
   */
  it('blames the filters when the box is empty', () => {
    expect(noMatchDescription({ query: '', facets: { repo: ['a'] } })).toBe(
      'Nothing matches the filters you have set.'
    )
  })

  it('names both when both are narrowing', () => {
    expect(noMatchDescription({ query: 'billing', facets: { repo: ['a'] } })).toBe(
      'Nothing matching “billing” with those filters.'
    )
  })

  it('trims the query it quotes', () => {
    expect(noMatchDescription({ query: '  billing  ', facets: {} })).toBe(
      'Nothing matching “billing”.'
    )
  })
})

describe('visibleFacets minOptions', () => {
  /**
   * The identity facets keep the two-option floor: one repository is one every
   * row is already in, so the chip offers a choice that changes nothing.
   */
  it('defaults to needing two options', () => {
    const one = { id: 'repo', label: 'Repo', options: [{ value: 'a', label: 'a' }] }
    expect(visibleFacets([one])).toEqual([])
  })

  it('lets a facet opt into being useful at one', () => {
    // "Unread" splits the list in two on its own — the distinction the blanket
    // rule got wrong.
    const one = {
      id: 'state',
      label: 'Status',
      minOptions: 1,
      options: [{ value: 'unread', label: 'Unread' }]
    }
    expect(visibleFacets([one])).toHaveLength(1)
  })

  it('still hides a facet with no options, whatever its floor', () => {
    expect(visibleFacets([{ id: 'state', label: 'Status', minOptions: 1, options: [] }])).toEqual(
      []
    )
  })
})
