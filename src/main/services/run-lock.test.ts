import { beforeEach, describe, expect, it } from 'vitest'
import type { Contact, PersonaTemplate, SandboxLevel } from '../../shared/domain'
import {
  acquire,
  activeRuns,
  blockingHolder,
  holdersOf,
  lockModeFor,
  resetRunLocks,
  workingPathFor,
  type LockMode,
  type RunHolder
} from './run-lock'

const REPO = '/Users/dev/my-app'
const OTHER_REPO = '/Users/dev/other-app'

let seq = 0

function holder(mode: LockMode, workingPath = REPO, contactName = 'Code Reviewer'): RunHolder {
  seq += 1
  return {
    runId: `run-${seq}`,
    contactId: `contact-${seq}`,
    contactName,
    workingPath,
    mode,
    startedAt: Date.now()
  }
}

function persona(sandbox: SandboxLevel): PersonaTemplate {
  return {
    id: 'persona-1',
    name: 'Code Reviewer',
    avatarColor: 'blue',
    backend: 'claude',
    systemPrompt: '',
    skillIds: [],
    mcpServerIds: [],
    sandbox,
    githubScope: 'read_only',
    model: null
  }
}

beforeEach(() => {
  resetRunLocks()
  seq = 0
})

const WORKTREE = '/Users/dev/Library/Application Support/persona-router/worktrees/my-app/buddy-a3f9'

function contact(overrides: Partial<Contact> = {}): Contact {
  return {
    id: 'c1',
    personaTemplateId: 'p1',
    repoPath: REPO,
    displayName: 'Code Reviewer · my-app',
    backendSessionId: null,
    repoTrust: null,
    worktreePath: null,
    branch: null,
    isolation: null,
    ...overrides
  }
}

describe('workingPathFor', () => {
  it('is the repo path when the contact has no worktree', () => {
    expect(workingPathFor(contact())).toBe(REPO)
  })

  // The seam Phase 12 changed. Two writing personas stop contending because
  // this stops returning the same string for both of them — not because the
  // lock got more permissive.
  it('is the worktree path when the contact has one', () => {
    expect(workingPathFor(contact({ worktreePath: WORKTREE }))).toBe(WORKTREE)
  })

  it('gives two worktree contacts on one repo different keys', () => {
    const a = contact({ id: 'a', worktreePath: `${WORKTREE}-a` })
    const b = contact({ id: 'b', worktreePath: `${WORKTREE}-b` })

    expect(workingPathFor(a)).not.toBe(workingPathFor(b))
  })
})

describe('lockModeFor', () => {
  it('makes read_only personas shared', () => {
    expect(lockModeFor(persona('read_only'), null)).toBe('shared')
  })

  it('makes anything that can write exclusive', () => {
    expect(lockModeFor(persona('workspace_write'), null)).toBe('exclusive')
    expect(lockModeFor(persona('full_access'), null)).toBe('exclusive')
  })

  // Isolation says *where*, sandbox says whether it locks. A writer that opted
  // out of worktrees is still a writer, and must not have been quietly unlocked
  // by this phase.
  it('still locks a writer left in the main tree', () => {
    expect(lockModeFor(persona('workspace_write'), 'shared')).toBe('exclusive')
    expect(lockModeFor(persona('workspace_write'), 'worktree')).toBe('exclusive')
  })

  it('leaves a reader shared under every isolation but exclusive', () => {
    expect(lockModeFor(persona('read_only'), 'shared')).toBe('shared')
    expect(lockModeFor(persona('read_only'), 'worktree')).toBe('shared')
  })

  // The escape hatch: `exclusive` exists to demand the main tree to itself, so
  // it has to outrank the read_only rule that never refuses anyone.
  it('makes exclusive isolation lock even a reader', () => {
    expect(lockModeFor(persona('read_only'), 'exclusive')).toBe('exclusive')
  })
})

describe('acquire', () => {
  it('lets unlimited readers share one path', () => {
    expect(acquire(holder('shared'))).not.toBeNull()
    expect(acquire(holder('shared'))).not.toBeNull()
    expect(acquire(holder('shared'))).not.toBeNull()
    expect(holdersOf(REPO)).toHaveLength(3)
  })

  // The whole point of narrowing blueprint §15D: this pair is Journey 2, and
  // under the blueprint's literal repo-wide lock it would not run. Written from
  // the claim in 00-progress.md ("readers are unlimited and never refused"),
  // not from the implementation — the previous version of this test asserted
  // the reader was refused, which is the behaviour the claim rules out.
  it('admits a reader while a writer holds', () => {
    expect(acquire(holder('exclusive'))).not.toBeNull()
    expect(acquire(holder('shared'))).not.toBeNull()
    expect(holdersOf(REPO)).toHaveLength(2)
  })

  it('refuses a second writer on the same path', () => {
    expect(acquire(holder('exclusive'))).not.toBeNull()
    expect(acquire(holder('exclusive'))).toBeNull()
  })

  // The other half of "only writer-vs-writer serializes". A reader cannot
  // mutate the tree, so it has nothing to protect and nothing to protect it
  // from — the worst case is the reader seeing a mid-write snapshot, which is
  // already accepted when a reader starts under a writer.
  it('admits a writer while a reader holds', () => {
    acquire(holder('shared'))
    expect(acquire(holder('exclusive'))).not.toBeNull()
    expect(holdersOf(REPO)).toHaveLength(2)
  })

  // Ordering matters here in a way the test above cannot show: with a reader
  // acquired first, a blocking check that returns the *first* holder would name
  // the reader and refuse on its account.
  // It also decides who the refusal names, which the user actually reads.
  it('refuses a second writer on account of the writer, not a reader ahead of it', () => {
    acquire(holder('shared', REPO, 'Code Reviewer'))
    acquire(holder('exclusive', REPO, 'Refactor Buddy'))

    const blocker = blockingHolder(REPO, 'exclusive')
    expect(blocker?.contactName).toBe('Refactor Buddy')
    expect(blocker?.mode).toBe('exclusive')
  })

  // The property, stated directly: nothing on the path refuses a reader. A
  // reader that is admitted only because the path happens to be quiet would
  // pass the test above without this holding.
  it('never refuses a reader, whatever else holds the path', () => {
    acquire(holder('exclusive'))
    acquire(holder('shared'))

    expect(blockingHolder(REPO, 'shared')).toBeNull()
    expect(acquire(holder('shared'))).not.toBeNull()
    expect(holdersOf(REPO)).toHaveLength(3)
  })

  it('does not let one path block another', () => {
    expect(acquire(holder('exclusive', REPO))).not.toBeNull()
    expect(acquire(holder('exclusive', OTHER_REPO))).not.toBeNull()
  })
})

describe('release', () => {
  // Readers never gated the writer, so the writer's own release is the only
  // thing that admits the next one — however many readers are still around.
  it('admits the next writer once the holding writer leaves, readers or not', () => {
    acquire(holder('shared'))
    const writer = acquire(holder('exclusive'))

    expect(acquire(holder('exclusive'))).toBeNull()

    writer?.()
    expect(acquire(holder('exclusive'))).not.toBeNull()
    expect(holdersOf(REPO)).toHaveLength(2)
  })

  it('admits the next writer once the first finishes', () => {
    const release = acquire(holder('exclusive'))
    release?.()
    expect(acquire(holder('exclusive'))).not.toBeNull()
  })

  // The messaging service releases in a `finally` that an abort path can reach
  // twice. A second release must not free a slot someone else has since taken.
  it('is idempotent', () => {
    const release = acquire(holder('exclusive'))
    release?.()

    const next = holder('exclusive')
    expect(acquire(next)).not.toBeNull()

    release?.()

    expect(holdersOf(REPO)).toHaveLength(1)
    expect(holdersOf(REPO)[0].runId).toBe(next.runId)
  })

  it('lets readers finish out of order without evicting each other', () => {
    const first = holder('shared')
    const second = holder('shared')
    const releaseFirst = acquire(first)
    acquire(second)

    releaseFirst?.()

    expect(holdersOf(REPO)).toHaveLength(1)
    expect(holdersOf(REPO)[0].runId).toBe(second.runId)
  })

  it('forgets a path once it empties', () => {
    const release = acquire(holder('shared'))
    release?.()
    expect(holdersOf(REPO)).toEqual([])
    expect(activeRuns()).toEqual([])
  })
})

describe('blockingHolder', () => {
  // Replaces an earlier case that named the writer refusing a *reader*. That
  // premise is gone: a reader is never refused, so there is no holder to name.
  it('names the writer that refuses another writer', () => {
    acquire(holder('exclusive', REPO, 'Refactor Buddy'))
    expect(blockingHolder(REPO, 'exclusive')?.contactName).toBe('Refactor Buddy')
  })

  it('names nobody when a reader asks, whatever holds the path', () => {
    acquire(holder('exclusive', REPO, 'Refactor Buddy'))
    expect(blockingHolder(REPO, 'shared')).toBeNull()
  })

  it('names nobody when only readers hold the path', () => {
    acquire(holder('shared', REPO, 'Code Reviewer'))
    expect(blockingHolder(REPO, 'exclusive')).toBeNull()
  })

  it('is null when nothing would refuse', () => {
    expect(blockingHolder(REPO, 'exclusive')).toBeNull()

    acquire(holder('shared'))
    expect(blockingHolder(REPO, 'shared')).toBeNull()
  })
})

describe('activeRuns', () => {
  it('reports holders across every path', () => {
    acquire(holder('shared', REPO))
    acquire(holder('shared', REPO))
    acquire(holder('exclusive', OTHER_REPO))

    expect(activeRuns()).toHaveLength(3)
    expect(new Set(activeRuns().map((run) => run.workingPath))).toEqual(new Set([REPO, OTHER_REPO]))
  })
})
