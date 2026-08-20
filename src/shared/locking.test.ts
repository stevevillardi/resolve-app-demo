import { describe, expect, it } from 'vitest'
import { blockingRun, lockModeFor, lockRefusal, workingPathFor } from './locking'
import type { LockMode } from './locking'
import type { Contact, PersonaTemplate, SandboxLevel } from './domain'

/**
 * The rule the composer predicts, tested as the composer asks it.
 *
 * `run-lock.test.ts` already covers this rule as *main* asks it — one path, one
 * mode, module state. What is tested here is the question the renderer actually
 * has: given every run in the fleet and one Contact's own row, would a send
 * right now be refused? That composition is where the answer was wrong, and it
 * was wrong in a direction no test of the pieces would have caught, because
 * every piece was right.
 *
 * Written from the claims the lock makes — one writer at a time on a working
 * copy, readers never refused and never refusing — rather than from the
 * implementation: the cases that matter are the ones the old renderer code got
 * wrong while looking entirely reasonable.
 */

const REPO = '/Users/dev/my-app'
const OTHER_REPO = '/Users/dev/other-app'
const WORKTREE = '/Users/dev/Library/Application Support/switchboard/worktrees/my-app/buddy-a3f9'

interface Run {
  contactId: string
  contactName: string
  workingPath: string
  mode: LockMode
}

function run(mode: LockMode, workingPath = REPO, contactName = 'Refactor Buddy'): Run {
  return { contactId: `other-${contactName}`, contactName, workingPath, mode }
}

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
    model: null,
    lastReadAt: null,
    ...overrides
  }
}

function persona(sandbox: SandboxLevel): PersonaTemplate {
  return {
    id: 'p1',
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

/** Exactly what ThreadView does, so the test asks the composer's own question. */
function wouldRefuse(subject: Contact, template: PersonaTemplate, runs: Run[]): Run | null {
  return blockingRun(runs, workingPathFor(subject), lockModeFor(template, subject.isolation))
}

describe('blockingRun', () => {
  it('refuses nobody when the run asking would be shared', () => {
    expect(blockingRun([run('exclusive')], REPO, 'shared')).toBeNull()
  })

  it('refuses an exclusive run only for an exclusive holder', () => {
    expect(blockingRun([run('shared')], REPO, 'exclusive')).toBeNull()
    expect(blockingRun([run('exclusive')], REPO, 'exclusive')).not.toBeNull()
  })

  it('only looks at holders of the same working path', () => {
    expect(blockingRun([run('exclusive', OTHER_REPO)], REPO, 'exclusive')).toBeNull()
  })

  it('names the exclusive holder, not whichever run came first', () => {
    const blocked = blockingRun(
      [run('shared', REPO, 'Doc Writer'), run('exclusive', REPO, 'Refactor Buddy')],
      REPO,
      'exclusive'
    )
    expect(blocked?.contactName).toBe('Refactor Buddy')
  })

  it('is null for an empty fleet', () => {
    expect(blockingRun([], REPO, 'exclusive')).toBeNull()
  })
})

describe('what the composer would predict', () => {
  // The regression that shipped. A read_only persona takes a shared lock, and a
  // shared lock is refused by nothing — so this composer must stay live while a
  // writer works. A reviewer reading a repo while a writer edits it is the pair
  // this app is built around, and the previous check disabled it.
  it('leaves a reader typeable while a writer holds the same tree', () => {
    expect(wouldRefuse(contact(), persona('read_only'), [run('exclusive')])).toBeNull()
  })

  // The other half, and the one that made the bug survive review: the same
  // wrong check produced the right answer here, so the feature looked correct.
  it('stops a writer while another writer holds the same tree', () => {
    expect(wouldRefuse(contact(), persona('workspace_write'), [run('exclusive')])).not.toBeNull()
  })

  // The entire purpose of giving a Contact its own checkout. An isolated
  // Contact locks that checkout, so a run in the main tree is not in its way —
  // the old check compared against repoPath and blocked it anyway.
  it('leaves an isolated writer typeable while the main tree is busy', () => {
    const isolated = contact({
      worktreePath: WORKTREE,
      branch: 'persona/buddy',
      isolation: 'worktree'
    })
    expect(wouldRefuse(isolated, persona('workspace_write'), [run('exclusive', REPO)])).toBeNull()
  })

  // And the collision that IS real between two isolated contacts: same
  // checkout, which only happens when something has gone wrong upstream — but
  // the prediction has to be able to see it, and the old one never could.
  it('stops an isolated writer when something else holds its own worktree', () => {
    const isolated = contact({
      worktreePath: WORKTREE,
      branch: 'persona/buddy',
      isolation: 'worktree'
    })
    expect(
      wouldRefuse(isolated, persona('workspace_write'), [run('exclusive', WORKTREE)])
    ).not.toBeNull()
  })

  // `exclusive` isolation means "give me the main tree to myself", so it locks
  // even though the persona can only read — the one case where sandbox does not
  // decide the mode.
  it('stops an exclusive reader while the tree is busy', () => {
    const demanding = contact({ isolation: 'exclusive' })
    expect(wouldRefuse(demanding, persona('read_only'), [run('exclusive')])).not.toBeNull()
  })
})

describe('lockRefusal', () => {
  it('names the holder and says how to clear it', () => {
    expect(lockRefusal('Refactor Buddy')).toBe(
      'Refactor Buddy is already working here. Wait for it to finish, or stop it from that conversation.'
    )
  })

  // The holder can disappear between the refusal and the message: acquire()
  // returns null, and by the time the caller asks who, that run has finished.
  it('still says something when the holder is gone', () => {
    expect(lockRefusal(null)).toBe('This working copy is busy.')
  })
})
