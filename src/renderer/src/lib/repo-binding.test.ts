import { describe, expect, it } from 'vitest'
import { repoBindingProblem } from './repo-binding'

describe('repoBindingProblem', () => {
  it('blocks a Codex persona bound to a plain directory', () => {
    // The live failure this exists for: `codex exec` exits 1 with "Not inside
    // a trusted directory", so the contact could never answer anything.
    const problem = repoBindingProblem('codex', 'Refactor Buddy', false)
    expect(problem?.message).toContain('Refactor Buddy')
    expect(problem?.message).toContain('Codex')
  })

  it('lets a Claude persona bind a plain directory', () => {
    // Not a blocker on Claude — it reads and edits a plain folder fine, it
    // just has no branch to open a PR from.
    expect(repoBindingProblem('claude', 'Code Reviewer', false)).toBeNull()
  })

  it('is happy with a git repo on either backend', () => {
    expect(repoBindingProblem('codex', 'Refactor Buddy', true)).toBeNull()
    expect(repoBindingProblem('claude', 'Code Reviewer', true)).toBeNull()
  })

  it('says nothing before a persona is chosen', () => {
    // The repo step is reachable with the persona still resolving; a blocker
    // that fires on undefined would disable Continue for no stated reason.
    expect(repoBindingProblem(undefined, undefined, false)).toBeNull()
  })

  it('still names the backend when the persona has no name yet', () => {
    expect(repoBindingProblem('codex', undefined, false)?.message).toContain('This persona')
  })
})
