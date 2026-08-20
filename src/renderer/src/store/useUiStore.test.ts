import { beforeEach, describe, expect, it } from 'vitest'
import { useUiStore } from './useUiStore'
import { EMPTY_LIST_FILTER } from '@/lib/list-filter'

/**
 * The filter state that crosses sections.
 *
 * Only the parts with a rule. Most of this store is a setter per field and
 * testing those would test zustand; `listFilters` and `showIn` carry the two
 * claims that a screen depends on being true.
 */

beforeEach(() => {
  useUiStore.setState({ section: 'home', listFilters: {} })
})

describe('listFilters', () => {
  it('keeps each section’s filter apart', () => {
    /**
     * The claim that let `ListPanel` drop its reset-on-section-change. One
     * shared query string genuinely did leak between rails — a search left in
     * Chats invisibly filtered Personas — so clearing it was right while there
     * was one. Keyed, there is nothing to leak.
     */
    const { setListFilter } = useUiStore.getState()
    setListFilter('chats', { query: 'billing', facets: {} })
    setListFilter('skills', { query: '', facets: { state: ['unused'] } })

    const { listFilters } = useUiStore.getState()
    expect(listFilters.chats).toEqual({ query: 'billing', facets: {} })
    expect(listFilters.skills).toEqual({ query: '', facets: { state: ['unused'] } })
    expect(listFilters.personas).toBeUndefined()
  })

  it('leaves a section untouched with no filter set', () => {
    // `ListPanel` reads `?? EMPTY_LIST_FILTER`, so absent has to stay absent
    // rather than being materialised as an empty object on first read.
    expect(useUiStore.getState().listFilters.routines).toBeUndefined()
  })
})

describe('showIn', () => {
  it('changes the section and narrows it in one act', () => {
    /**
     * The reason this is a store action and not two calls at each site. Done
     * separately it is one chance per call site to set the section and forget
     * the filter, and the symptom is a rail that navigated but did not narrow —
     * which looks exactly like the feature not working.
     */
    useUiStore.getState().showIn('chats', { query: '', facets: { repo: ['/repo/billing'] } })

    const state = useUiStore.getState()
    expect(state.section).toBe('chats')
    expect(state.listFilters.chats).toEqual({ query: '', facets: { repo: ['/repo/billing'] } })
  })

  it('replaces the target’s filter rather than merging into it', () => {
    // The caller is stating the whole question. Merging would AND the new facet
    // onto whatever the user last left there and could land them on an empty
    // list they did not ask for.
    useUiStore.getState().setListFilter('chats', { query: 'old', facets: { persona: ['p1'] } })
    useUiStore.getState().showIn('chats', { query: '', facets: { repo: ['/repo/billing'] } })

    expect(useUiStore.getState().listFilters.chats).toEqual({
      query: '',
      facets: { repo: ['/repo/billing'] }
    })
  })

  it('does not disturb the filter on any other section', () => {
    useUiStore.getState().setListFilter('skills', { query: 'ts', facets: {} })
    useUiStore.getState().showIn('chats', EMPTY_LIST_FILTER)

    expect(useUiStore.getState().listFilters.skills).toEqual({ query: 'ts', facets: {} })
  })
})
