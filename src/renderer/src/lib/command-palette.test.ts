import { describe, expect, it } from 'vitest'
import { buildCommandSections, scoreCommand, type CommandItem } from './command-palette'

const item = (over: Partial<CommandItem> & Pick<CommandItem, 'id' | 'label'>): CommandItem => ({
  group: 'Conversations',
  ...over
})

describe('scoreCommand', () => {
  it('matches everything on an empty query', () => {
    expect(scoreCommand(item({ id: 'a', label: 'Code Reviewer' }), '')).toBeGreaterThan(0)
    expect(scoreCommand(item({ id: 'a', label: 'Code Reviewer' }), '   ')).toBeGreaterThan(0)
  })

  it('ranks a label prefix above a word start above a bare substring', () => {
    const target = item({ id: 'a', label: 'Code Reviewer' })
    const prefix = scoreCommand(target, 'code')
    const wordStart = scoreCommand(target, 'review')
    const substring = scoreCommand(target, 'ewer')

    expect(prefix).toBeGreaterThan(wordStart)
    expect(wordStart).toBeGreaterThan(substring)
    expect(substring).toBeGreaterThan(0)
  })

  it('finds a word start after a separator, not just after a space', () => {
    const target = item({ id: 'a', label: 'Code Reviewer · persona-router' })
    expect(scoreCommand(target, 'persona')).toBe(80)
    expect(scoreCommand(target, 'router')).toBe(80)
  })

  it('ranks a detail-only match below every label match', () => {
    const target = item({
      id: 'a',
      label: 'Docs Writer',
      detail: '~/code/marketing-site'
    })
    expect(scoreCommand(target, 'marketing')).toBe(30)
    expect(scoreCommand(target, 'docs')).toBeGreaterThan(30)
  })

  it('searches keywords that are never displayed', () => {
    const target = item({ id: 'a', label: 'Connect GitHub', keywords: ['auth', 'login'] })
    expect(scoreCommand(target, 'login')).toBe(30)
  })

  it('returns 0 when nothing matches', () => {
    expect(scoreCommand(item({ id: 'a', label: 'Code Reviewer' }), 'zzz')).toBe(0)
  })

  it('is case insensitive on both sides', () => {
    expect(scoreCommand(item({ id: 'a', label: 'Code Reviewer' }), 'CODE')).toBe(100)
  })
})

describe('buildCommandSections', () => {
  const items: CommandItem[] = [
    item({ id: 'c1', label: 'Code Reviewer', detail: '~/code/persona-router' }),
    item({ id: 'c2', label: 'Refactor Buddy', detail: '~/code/persona-router' }),
    item({ id: 'p1', label: 'Code Reviewer', group: 'Personas' }),
    item({ id: 's1', label: 'Security checklist', group: 'Skills' }),
    item({ id: 'g1', label: 'Usage', group: 'Go to' })
  ]

  it('drops groups that have no matching item', () => {
    const sections = buildCommandSections(items, 'security')
    expect(sections.map((section) => section.group)).toEqual(['Skills'])
  })

  it('keeps the declared group order regardless of score', () => {
    // The Skills item scores a full prefix hit while the Conversations item
    // only matches on detail, but Conversations still comes first.
    const sections = buildCommandSections(
      [
        item({ id: 's1', label: 'Security checklist', group: 'Skills' }),
        item({ id: 'c1', label: 'Code Reviewer', detail: 'security audit repo' })
      ],
      'security'
    )
    expect(sections.map((section) => section.group)).toEqual(['Conversations', 'Skills'])
  })

  it('orders within a group by score', () => {
    const sections = buildCommandSections(
      [
        item({ id: 'a', label: 'Refactor Buddy', detail: 'code review helper' }),
        item({ id: 'b', label: 'Code Reviewer' })
      ],
      'code'
    )
    expect(sections[0].items.map((entry) => entry.id)).toEqual(['b', 'a'])
  })

  it('preserves input order on a tie rather than re-sorting', () => {
    const sections = buildCommandSections(
      [
        item({ id: 'newest', label: 'Code Reviewer' }),
        item({ id: 'older', label: 'Code Reviewer' })
      ],
      'code'
    )
    expect(sections[0].items.map((entry) => entry.id)).toEqual(['newest', 'older'])
  })

  it('returns every group in order on an empty query', () => {
    const sections = buildCommandSections(items, '')
    expect(sections.map((section) => section.group)).toEqual([
      'Conversations',
      'Personas',
      'Skills',
      'Go to'
    ])
    expect(sections[0].items).toHaveLength(2)
  })

  it('returns nothing when no item matches', () => {
    expect(buildCommandSections(items, 'zzzz')).toEqual([])
  })
})
