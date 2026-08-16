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
    sandbox,
    githubScope: 'read_only',
    model: null
  }
}

beforeEach(() => {
  resetRunLocks()
  seq = 0
})

describe('workingPathFor', () => {
  // Today's answer, and the seam the worktree phase changes. Pinned so that
  // change is a deliberate edit to a failing test rather than a silent one.
  it('is the contact repo path', () => {
    const contact: Contact = {
      id: 'c1',
      personaTemplateId: 'p1',
      repoPath: REPO,
      displayName: 'Code Reviewer · my-app',
      backendSessionId: null
    }
    expect(workingPathFor(contact)).toBe(REPO)
  })
})

describe('lockModeFor', () => {
  it('makes read_only personas shared', () => {
    expect(lockModeFor(persona('read_only'))).toBe('shared')
  })

  it('makes anything that can write exclusive', () => {
    expect(lockModeFor(persona('workspace_write'))).toBe('exclusive')
    expect(lockModeFor(persona('full_access'))).toBe('exclusive')
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
  // under the blueprint's literal repo-wide lock it would not run.
  it('lets a reader and a writer run together', () => {
    expect(acquire(holder('shared'))).not.toBeNull()
    expect(acquire(holder('exclusive'))).toBeNull()

    resetRunLocks()

    expect(acquire(holder('exclusive'))).not.toBeNull()
    expect(acquire(holder('shared'))).toBeNull()
  })

  it('refuses a second writer on the same path', () => {
    expect(acquire(holder('exclusive'))).not.toBeNull()
    expect(acquire(holder('exclusive'))).toBeNull()
  })

  it('refuses a writer while a reader holds', () => {
    acquire(holder('shared'))
    expect(acquire(holder('exclusive'))).toBeNull()
  })

  it('refuses a reader while a writer holds', () => {
    acquire(holder('exclusive'))
    expect(acquire(holder('shared'))).toBeNull()
  })

  it('does not let one path block another', () => {
    expect(acquire(holder('exclusive', REPO))).not.toBeNull()
    expect(acquire(holder('exclusive', OTHER_REPO))).not.toBeNull()
  })
})

describe('release', () => {
  it('admits a writer once the last reader leaves', () => {
    const first = acquire(holder('shared'))
    const second = acquire(holder('shared'))

    first?.()
    expect(acquire(holder('exclusive'))).toBeNull()

    second?.()
    expect(acquire(holder('exclusive'))).not.toBeNull()
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
  it('names the writer that refuses a reader', () => {
    acquire(holder('exclusive', REPO, 'Refactor Buddy'))
    expect(blockingHolder(REPO, 'shared')?.contactName).toBe('Refactor Buddy')
  })

  it('names a reader that refuses a writer', () => {
    acquire(holder('shared', REPO, 'Code Reviewer'))
    expect(blockingHolder(REPO, 'exclusive')?.contactName).toBe('Code Reviewer')
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
    expect(new Set(activeRuns().map((run) => run.workingPath))).toEqual(
      new Set([REPO, OTHER_REPO])
    )
  })
})
