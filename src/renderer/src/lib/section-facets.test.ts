import { describe, expect, it } from 'vitest'
import { backendFacet, personaFacet, repoFacet, sandboxFacet, stateFacet } from './section-facets'
import { visibleFacets } from './list-filter'
import type { Contact, PersonaTemplate } from '@/types'

function persona(over: Partial<PersonaTemplate> & { id: string }): PersonaTemplate {
  return {
    name: over.id,
    avatarColor: '#2a78d6',
    backend: 'claude',
    model: null,
    systemPrompt: '',
    skillIds: [],
    mcpServerIds: [],
    sandbox: 'read_only',
    githubScope: 'read_only',
    ...over
  } as PersonaTemplate
}

function contact(id: string, personaTemplateId: string, repoPath = '/repo/a'): Contact {
  return { id, personaTemplateId, repoPath, displayName: id } as Contact
}

const values = (spec: { options: { value: string }[] }): string[] =>
  spec.options.map((option) => option.value)
const labels = (spec: { options: { label: string }[] }): string[] =>
  spec.options.map((option) => option.label)

describe('repoFacet', () => {
  it('offers each repo once, by the name the rows already show', () => {
    const spec = repoFacet(['/Users/dev/checkout-service', '/Users/dev/checkout-service'])
    expect(values(spec)).toEqual(['/Users/dev/checkout-service'])
    expect(labels(spec)).toEqual(['checkout-service'])
  })

  /**
   * The collision this app is one `git clone` away from. Rows show the last
   * path segment everywhere, so two checkouts called `api` are indistinguishable
   * on screen — and de-duplicating on the *name* rather than the path would go
   * further and silently filter to both at once.
   */
  it('keeps two repos with the same folder name apart', () => {
    const spec = repoFacet(['/Users/dev/acme/api', '/Users/dev/other/api'])

    expect(values(spec)).toHaveLength(2)
    expect(labels(spec).sort()).toEqual(['api (acme)', 'api (other)'])
  })

  it('does not disambiguate the names that are already unique', () => {
    // A parenthesised parent on every row would be noise on the common case.
    const spec = repoFacet(['/Users/dev/acme/api', '/Users/dev/other/web'])
    expect(labels(spec).sort()).toEqual(['api', 'web'])
  })

  it('sorts by the name shown, not by the full path', () => {
    const spec = repoFacet(['/z/alpha', '/a/zulu'])
    expect(labels(spec)).toEqual(['alpha', 'zulu'])
  })

  it('is hidden by visibleFacets when there is only one repo', () => {
    expect(visibleFacets([repoFacet(['/repo/only'])])).toEqual([])
  })
})

describe('personaFacet', () => {
  it('offers only personas something is actually bound to', () => {
    /**
     * A persona nobody has bound is a template, not a filter: selecting it
     * could only ever empty the list, which reads as a broken chip rather than
     * as an honest zero.
     */
    const spec = personaFacet(
      [persona({ id: 'used', name: 'Code Reviewer' }), persona({ id: 'unused' })],
      [contact('c1', 'used')]
    )

    expect(values(spec)).toEqual(['used'])
    expect(labels(spec)).toEqual(['Code Reviewer'])
  })

  it('is empty when no contact exists yet', () => {
    expect(personaFacet([persona({ id: 'a' })], []).options).toEqual([])
  })
})

describe('backendFacet', () => {
  it('offers both only when both are in use', () => {
    const spec = backendFacet([
      persona({ id: 'a', backend: 'claude' }),
      persona({ id: 'b', backend: 'codex' })
    ])
    expect(values(spec)).toEqual(['claude', 'codex'])
  })

  it('collapses to nothing renderable on a single-backend profile', () => {
    // Derived rather than hardcoded to both, so a Claude-only profile never
    // sees a chip whose other half can only ever return an empty list.
    const spec = backendFacet([persona({ id: 'a', backend: 'claude' })])

    expect(values(spec)).toEqual(['claude'])
    expect(visibleFacets([spec])).toEqual([])
  })
})

describe('sandboxFacet', () => {
  it('offers the postures actually present, in escalating order', () => {
    const spec = sandboxFacet([
      persona({ id: 'a', sandbox: 'workspace_write' }),
      persona({ id: 'b', sandbox: 'read_only' })
    ])
    // Order is the permission ladder, not the order personas happened to be
    // created in — it is the order every other scope control in the app uses.
    expect(values(spec)).toEqual(['read_only', 'workspace_write'])
  })
})

describe('stateFacet', () => {
  it('drops states nothing is currently in', () => {
    // "Paused" is worth offering when something is paused and is a dead chip
    // when nothing is.
    const spec = stateFacet('Status', [
      { value: 'paused', label: 'Paused', present: false },
      { value: 'missed', label: 'Missed a run', present: true }
    ])

    expect(values(spec)).toEqual(['missed'])
  })

  /**
   * A state facet is still worth rendering with a single option, unlike every
   * other kind.
   *
   * "Unread" on its own splits the list into the rows that are and the rows
   * that are not, which is the whole question — whereas a lone *repository* is
   * one every row is already in, so its chip changes nothing. Caught by looking
   * at the running app: the Chats rail had unread badges on screen and no chip
   * to filter by them, because the blanket two-option rule had swallowed a
   * facet that was doing real work.
   */
  it('is still shown when only one state is present', () => {
    const spec = stateFacet('Status', [
      { value: 'paused', label: 'Paused', present: true },
      { value: 'missed', label: 'Missed a run', present: false }
    ])

    expect(values(spec)).toEqual(['paused'])
    expect(visibleFacets([spec])).toHaveLength(1)
  })

  it('is hidden when no state is present at all', () => {
    const spec = stateFacet('Status', [{ value: 'paused', label: 'Paused', present: false }])
    expect(visibleFacets([spec])).toEqual([])
  })
})
