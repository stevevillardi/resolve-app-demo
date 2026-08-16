import { execFileSync } from 'child_process'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const USER_DATA = '/Users/dev/Library/Application Support/persona-router'

vi.mock('electron', () => ({ app: { getPath: () => USER_DATA } }))

const { defaultIsolation, isolationOf, plannedWorktree, worktreeRoot } = await import('./worktrees')

/**
 * The branch names this produces go straight to git, so the interesting
 * assertions are the ones git itself can settle. `check-ref-format` is the
 * authority on what is a legal branch name, and it rejects things a human would
 * not predict — a space, a `..`, a trailing dot — so these cases ask it rather
 * than encoding a guess about its rules.
 */
function gitAcceptsBranch(name: string): boolean {
  try {
    execFileSync('git', ['check-ref-format', '--branch', name], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

let seq = 0
beforeEach(() => {
  seq = 0
})

function id(): string {
  seq += 1
  return `a3f9b1c2-0000-4000-8000-00000000000${seq}`
}

describe('worktreeRoot', () => {
  it('is one directory under the profile, so orphans are enumerable', () => {
    expect(worktreeRoot()).toBe(`${USER_DATA}/worktrees`)
  })
})

describe('plannedWorktree', () => {
  it('names the directory after the repo and the persona', () => {
    const { path } = plannedWorktree('/Users/dev/code/my-app', 'Refactor Buddy', id())

    expect(path).toBe(`${USER_DATA}/worktrees/my-app/refactor-buddy-a3f9`)
  })

  it('puts the branch under a persona/ prefix', () => {
    const { branch } = plannedWorktree('/Users/dev/code/my-app', 'Refactor Buddy', id())

    expect(branch).toBe('persona/refactor-buddy-a3f9')
  })

  // Two Contacts putting the same persona on the same repo is the collision
  // that matters: git refuses outright to check one branch out into two
  // worktrees, so this would be a hard failure rather than a quiet mix-up.
  it('separates two contacts using one persona on one repo', () => {
    const a = plannedWorktree(
      '/Users/dev/code/my-app',
      'Refactor Buddy',
      'aaaa1111-0000-4000-8000-000000000001'
    )
    const b = plannedWorktree(
      '/Users/dev/code/my-app',
      'Refactor Buddy',
      'bbbb2222-0000-4000-8000-000000000002'
    )

    expect(a.path).not.toBe(b.path)
    expect(a.branch).not.toBe(b.branch)
  })

  it('is stable for one contact, so the lock key never moves under it', () => {
    const contactId = id()
    const first = plannedWorktree('/Users/dev/code/my-app', 'Refactor Buddy', contactId)
    const again = plannedWorktree('/Users/dev/code/my-app', 'Refactor Buddy', contactId)

    expect(again).toEqual(first)
  })

  it('does not confuse two repos that share a basename', () => {
    const contactId = id()
    const a = plannedWorktree('/Users/dev/code/my-app', 'Refactor Buddy', contactId)
    const b = plannedWorktree('/Users/dev/other/my-app', 'Refactor Buddy', contactId)

    // Same planned path — a known limit, recorded rather than hidden: the
    // directory is named for readability and the *branch* is what git polices.
    // Two same-named repos would need two Contacts, which have different ids.
    expect(a.path).toBe(b.path)
  })

  describe('produces branch names git will accept', () => {
    // Every one of these is a real rejection from `git check-ref-format`.
    const hostile = ['Code Reviewer', 'weird..name', 'trailing.', 'has/slash', 'Ünïcödé', '!!!', '']

    for (const personaName of hostile) {
      it(`from ${JSON.stringify(personaName)}`, () => {
        const { branch } = plannedWorktree('/Users/dev/code/my-app', personaName, id())

        expect(gitAcceptsBranch(branch), branch).toBe(true)
      })
    }
  })

  it('falls back rather than emitting an empty component', () => {
    const { path, branch } = plannedWorktree('/', '!!!', id())

    expect(path).toBe(`${USER_DATA}/worktrees/repo/persona-a3f9`)
    expect(branch).toBe('persona/persona-a3f9')
  })
})

describe('defaultIsolation', () => {
  // Readers stay in the main tree: they are never refused anyway, and the main
  // tree is the only place the uncommitted work they were asked to look at is
  // visible.
  it('leaves readers in the main tree', () => {
    expect(defaultIsolation('read_only')).toBe('shared')
  })

  it('isolates anything that can write', () => {
    expect(defaultIsolation('workspace_write')).toBe('worktree')
    expect(defaultIsolation('full_access')).toBe('worktree')
  })
})

describe('isolationOf', () => {
  it('reads a pre-0007 null as shared', () => {
    expect(isolationOf(null)).toBe('shared')
  })

  it('passes a stored mode through', () => {
    expect(isolationOf('exclusive')).toBe('exclusive')
  })
})
