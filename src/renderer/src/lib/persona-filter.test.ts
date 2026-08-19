import { describe, expect, it } from 'vitest'
import { filterPersonas, PERSONA_FILTER_THRESHOLD } from './persona-filter'
import type { PersonaTemplate } from '@/types'

function persona(overrides: Partial<PersonaTemplate> & { name: string }): PersonaTemplate {
  return {
    id: overrides.name.toLowerCase().replace(/\s+/g, '-'),
    avatarColor: '#2a78d6',
    avatarSeed: overrides.name.toLowerCase().replace(/\s+/g, '-'),
    backend: 'claude',
    model: null,
    systemPrompt: 'Do the thing.',
    skillIds: [],
    mcpServerIds: [],
    sandbox: 'read_only',
    githubScope: 'read_only',
    ...overrides
  }
}

const PERSONAS = [
  persona({ name: 'Code Reviewer' }),
  persona({ name: 'Refactor Buddy', sandbox: 'workspace_write' }),
  persona({ name: 'Test Author', backend: 'codex' }),
  persona({ name: 'Security Auditor' })
]

const names = (list: PersonaTemplate[]): string[] => list.map((entry) => entry.name)

describe('filterPersonas', () => {
  it('returns everything, in order, for an empty query', () => {
    expect(names(filterPersonas(PERSONAS, ''))).toEqual(names(PERSONAS))
    expect(names(filterPersonas(PERSONAS, '   '))).toEqual(names(PERSONAS))
  })

  // Word-start, which is `scoreCommand`'s tier 80 and the reason this reuses it
  // rather than doing a substring match: people type the distinctive word.
  it('finds a persona by a word that is not the first', () => {
    expect(names(filterPersonas(PERSONAS, 'buddy'))).toEqual(['Refactor Buddy'])
    expect(names(filterPersonas(PERSONAS, 'auditor'))).toEqual(['Security Auditor'])
  })

  /**
   * The reason backend and scope are in `detail`. Both are shown on the row as
   * badges, so a filter that could not match them would mean the visible text
   * and the searchable text disagreed — and the user would conclude the persona
   * was not there.
   */
  it('narrows by backend and by scope, which the rows already display', () => {
    expect(names(filterPersonas(PERSONAS, 'codex'))).toEqual(['Test Author'])
    expect(names(filterPersonas(PERSONAS, 'workspace_write'))).toEqual(['Refactor Buddy'])
  })

  it('ranks a name match above a backend match', () => {
    // "code" is the start of one name; nothing else should outrank it.
    expect(names(filterPersonas(PERSONAS, 'code'))[0]).toBe('Code Reviewer')
  })

  // Equal matches keep the incoming order — which is `personas.list`'s, and so
  // the order the step shows with no query. Re-sorting would make the list
  // appear to jump as the user types.
  it('keeps the input order between equally good matches', () => {
    const both = [persona({ name: 'Review One' }), persona({ name: 'Review Two' })]
    expect(names(filterPersonas(both, 'review'))).toEqual(['Review One', 'Review Two'])
  })

  it('returns nothing rather than everything when nothing matches', () => {
    expect(filterPersonas(PERSONAS, 'zzzz')).toEqual([])
  })
})

describe('PERSONA_FILTER_THRESHOLD', () => {
  /**
   * The seeded default is three personas, and the step must not show a search
   * box to a profile that has just been created — it would be a control over a
   * list short enough to read at a glance, in a dialog already short of room.
   */
  it('is above the number of personas a fresh profile has', () => {
    expect(PERSONA_FILTER_THRESHOLD).toBeGreaterThan(3)
  })
})
