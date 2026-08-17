import { describe, expect, it } from 'vitest'
import { byRecency } from './conversation-sort'

interface Row {
  name: string
  at?: number
}

function sort(rows: Row[]): string[] {
  return byRecency(
    rows,
    (row) => row.at,
    (row) => row.name
  ).map((row) => row.name)
}

describe('byRecency', () => {
  it('puts the most recent message first', () => {
    expect(
      sort([
        { name: 'a', at: 1 },
        { name: 'b', at: 3 },
        { name: 'c', at: 2 }
      ])
    ).toEqual(['b', 'c', 'a'])
  })

  it('sends never-messaged rows to a stable alphabetical tail', () => {
    expect(sort([{ name: 'z' }, { name: 'a', at: 1 }, { name: 'b' }])).toEqual(['a', 'b', 'z'])
  })

  // Two conversations touched by the same turn share a millisecond; a
  // re-render must not swap them.
  it('breaks timestamp ties by name', () => {
    expect(
      sort([
        { name: 'b', at: 5 },
        { name: 'a', at: 5 }
      ])
    ).toEqual(['a', 'b'])
  })

  it('does not mutate its input', () => {
    const rows: Row[] = [
      { name: 'b', at: 1 },
      { name: 'a', at: 2 }
    ]
    sort(rows)
    expect(rows[0].name).toBe('b')
  })
})
