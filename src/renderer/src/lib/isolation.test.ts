import { describe, expect, it } from 'vitest'
import { ISOLATION_OPTIONS } from './isolation'
import { isolationSchema } from '../../../shared/domain'

/**
 * A list of options is a promise that it is the whole list, and nothing in the
 * type system holds an array to a union. The failure would be silent in the
 * worst way: a fourth mode added to `Isolation`, honoured everywhere in main,
 * and simply absent from the two screens where a human picks one.
 */
describe('ISOLATION_OPTIONS', () => {
  it('offers every isolation mode the domain defines', () => {
    expect(new Set(ISOLATION_OPTIONS.map((option) => option.value))).toEqual(
      new Set(isolationSchema.options)
    )
  })

  it('offers each of them once', () => {
    expect(ISOLATION_OPTIONS).toHaveLength(isolationSchema.options.length)
  })

  // Only a worktree needs git. A plain directory can still be worked in
  // directly, and marking the other two as needing a repo would hide the only
  // modes available there — which is the state a non-git folder is always in.
  it('marks only the worktree mode as needing a repo', () => {
    const needsGit = ISOLATION_OPTIONS.filter((option) => option.needsGit).map((o) => o.value)
    expect(needsGit).toEqual(['worktree'])
  })
})
