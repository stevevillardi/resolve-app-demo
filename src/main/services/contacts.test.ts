import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestDb } from '../db/test-db'
import { groups, personaTemplates } from '../db/schema'
import type { AppDatabase } from '../db/create'
import type { Contact } from '../../shared/domain'

/**
 * The invariant under test is blueprint §4's "one Group per repo". A Contact
 * is the only thing that creates a Group, so it has to hold from the very
 * first contact bound to a path — not be reconciled later.
 */

let db: AppDatabase

vi.mock('../db', () => ({ initDb: () => db }))
// createContact plans a writer's worktree path, which is rooted in the profile
// directory — the only thing this test needs Electron for.
vi.mock('electron', () => ({
  app: { getPath: () => '/Users/dev/Library/Application Support/persona-router' }
}))

const {
  createContact,
  getContact,
  listContacts,
  rebindContactPersona,
  renameContact,
  setBackendSessionId,
  setRepoTrust
} = await import('./contacts')
const { ensureGroupForRepo, listGroups } = await import('./groups')
const { acquire, resetRunLocks } = await import('./run-lock')

const PERSONA_ID = 'persona-1'

function draft(
  repoPath: string,
  displayName: string
): {
  personaTemplateId: string
  repoPath: string
  displayName: string
} {
  return { personaTemplateId: PERSONA_ID, repoPath, displayName }
}

beforeEach(() => {
  db = createTestDb()
  resetRunLocks()
  db.insert(personaTemplates)
    .values({
      id: PERSONA_ID,
      name: 'Code Reviewer',
      avatarColor: '#2a78d6',
      backend: 'claude',
      systemPrompt: '',
      skillIds: [],
      sandbox: 'read_only',
      githubScope: 'read_only'
    })
    .run()
})

describe('create', () => {
  it('mints an id and starts with no session', () => {
    // §4: backendSessionId is a resume key, and there is nothing to resume
    // until a turn has actually run (Phase 6).
    const contact = createContact(draft('~/code/app', 'Code Reviewer · app'))
    expect(contact.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(contact.backendSessionId).toBeNull()
  })

  it('round-trips through the database', () => {
    const contact = createContact(draft('~/code/app', 'Code Reviewer · app'))
    expect(getContact(contact.id)).toEqual(contact)
  })

  it('returns null for an unknown id', () => {
    expect(getContact('nope')).toBeNull()
  })

  it('lists alphabetically by display name', () => {
    createContact(draft('~/code/z', 'Zebra'))
    createContact(draft('~/code/a', 'Alpha'))
    expect(listContacts().map((c) => c.displayName)).toEqual(['Alpha', 'Zebra'])
  })

  it('refuses a contact bound to a persona that does not exist', () => {
    // The foreign key is what stops an orphaned contact from being created.
    expect(() =>
      createContact({
        personaTemplateId: 'no-such-persona',
        repoPath: '~/code/app',
        displayName: 'Orphan'
      })
    ).toThrow()
  })
})

describe('isolation', () => {
  function writerPersona(id: string): void {
    db.insert(personaTemplates)
      .values({
        id,
        name: 'Refactor Buddy',
        avatarColor: '#c2410c',
        backend: 'claude',
        systemPrompt: '',
        skillIds: [],
        sandbox: 'workspace_write',
        githubScope: 'open_pr'
      })
      .run()
  }

  it('leaves a reader in the main tree with no worktree', () => {
    const contact = createContact(draft('~/code/app', 'Code Reviewer · app'))

    expect(contact.isolation).toBe('shared')
    expect(contact.worktreePath).toBeNull()
    expect(contact.branch).toBeNull()
  })

  // The path is planned at create time precisely so workingPathFor() is a pure
  // function of the row from the very first turn — startTurn() is synchronous
  // and cannot wait on a `git worktree add`.
  it('plans a writer a worktree path and branch before either exists', () => {
    writerPersona('persona-writer')

    const contact = createContact({
      personaTemplateId: 'persona-writer',
      repoPath: '~/code/app',
      displayName: 'Refactor Buddy · app'
    })

    expect(contact.isolation).toBe('worktree')
    expect(contact.worktreePath).toContain('/worktrees/app/refactor-buddy-')
    expect(contact.branch).toMatch(/^persona\/refactor-buddy-/)
  })

  it('persists the planned path rather than recomputing it on read', () => {
    writerPersona('persona-writer')
    const contact = createContact({
      personaTemplateId: 'persona-writer',
      repoPath: '~/code/app',
      displayName: 'Refactor Buddy · app'
    })

    expect(getContact(contact.id)?.worktreePath).toBe(contact.worktreePath)
  })

  it('honours an explicit choice over the default', () => {
    writerPersona('persona-writer')

    const contact = createContact({
      personaTemplateId: 'persona-writer',
      repoPath: '~/code/app',
      displayName: 'Refactor Buddy · app',
      isolation: 'exclusive'
    })

    expect(contact.isolation).toBe('exclusive')
    // `exclusive` runs in the main tree on purpose — it is the mode for work a
    // worktree cannot serve, like needing uncommitted files or node_modules.
    expect(contact.worktreePath).toBeNull()
  })

  it('gives two writers on one repo different working paths', () => {
    writerPersona('persona-writer')
    const a = createContact({
      personaTemplateId: 'persona-writer',
      repoPath: '~/code/app',
      displayName: 'Refactor Buddy · app'
    })
    const b = createContact({
      personaTemplateId: 'persona-writer',
      repoPath: '~/code/app',
      displayName: 'Refactor Buddy 2 · app'
    })

    expect(a.worktreePath).not.toBe(b.worktreePath)
    expect(a.branch).not.toBe(b.branch)
  })
})

describe('group auto-creation', () => {
  it('creates the repo group on the first contact bound there', () => {
    expect(listGroups()).toEqual([])
    createContact(draft('~/code/app', 'Code Reviewer · app'))
    expect(listGroups().map((g) => g.repoPath)).toEqual(['~/code/app'])
  })

  it('reuses the existing group for a second contact on the same repo', () => {
    createContact(draft('~/code/app', 'Code Reviewer · app'))
    const before = listGroups()[0]
    createContact(draft('~/code/app', 'Docs Writer · app'))

    const after = listGroups()
    expect(after).toHaveLength(1)
    expect(after[0].id).toBe(before.id)
  })

  it('creates a separate group per repo', () => {
    createContact(draft('~/code/app', 'Code Reviewer · app'))
    createContact(draft('~/code/site', 'Code Reviewer · site'))
    expect(listGroups().map((g) => g.repoPath)).toEqual(['~/code/app', '~/code/site'])
  })

  it('leaves no group behind when the contact insert fails', () => {
    // Both writes are in one transaction, so a rejected contact must not
    // leave an orphan group for a repo nothing is bound to.
    expect(() =>
      createContact({
        personaTemplateId: 'no-such-persona',
        repoPath: '~/code/ghost',
        displayName: 'Ghost'
      })
    ).toThrow()
    expect(listGroups()).toEqual([])
  })
})

describe('rename', () => {
  it('changes the display name and nothing else', () => {
    // The claim this function makes is not "it renames" — it is "it renames and
    // touches nothing else". repoPath is the Group key and the run-lock key,
    // worktreePath and branch are pointed at by a checkout on disk, and
    // backendSessionId is what makes a conversation survive quitting the app.
    // So the assertion is on the whole row, not on the one field that changed:
    // anything else moving here is a live worktree or a live session orphaned.
    //
    // The session id and the worktree have to be *set* for this to have teeth.
    // The first version of this test renamed a fresh contact, whose
    // backendSessionId and worktreePath are both null — so a mutation that
    // nulled them on every rename passed it. A row where every load-bearing
    // column is already null cannot detect a function that clears them.
    const contact = createContact({
      personaTemplateId: PERSONA_ID,
      repoPath: '~/code/app',
      displayName: 'Code Reviewer · app',
      isolation: 'worktree'
    })
    setBackendSessionId(contact.id, 'session-abc123')
    const before = getContact(contact.id) as Contact
    expect(before.backendSessionId).toBe('session-abc123')
    expect(before.worktreePath).not.toBeNull()
    expect(before.branch).not.toBeNull()

    const renamed = renameContact(contact.id, 'Reviewer')

    expect(renamed).toEqual({ ...before, displayName: 'Reviewer' })
    expect(getContact(contact.id)).toEqual(renamed)
  })

  it('trims, because a name of spaces is a row with no visible label', () => {
    const contact = createContact(draft('~/code/app', 'Code Reviewer · app'))
    expect(renameContact(contact.id, '  Reviewer  ').displayName).toBe('Reviewer')
  })

  it('refuses a name that is only whitespace', () => {
    // min(1) at the Zod boundary passes '   ', so the service has to be the
    // one that says no — the contract cannot see that it trims to nothing.
    const contact = createContact(draft('~/code/app', 'Code Reviewer · app'))
    expect(() => renameContact(contact.id, '   ')).toThrow(/needs a name/)
    expect(getContact(contact.id)?.displayName).toBe('Code Reviewer · app')
  })

  it('throws on an unknown id rather than silently doing nothing', () => {
    expect(() => renameContact('nope', 'Reviewer')).toThrow(/No such contact/)
  })

  it('re-sorts the list, because listContacts orders by display name', () => {
    // The renamed row's place in the list has moved, so returning the caller's
    // patched copy would be describing a list that no longer exists.
    const a = createContact(draft('~/code/a', 'Alpha'))
    createContact(draft('~/code/b', 'Bravo'))
    renameContact(a.id, 'Zulu')
    expect(listContacts().map((contact) => contact.displayName)).toEqual(['Bravo', 'Zulu'])
  })
})

describe('ensureGroupForRepo', () => {
  it('is idempotent', () => {
    const first = ensureGroupForRepo('~/code/app')
    const second = ensureGroupForRepo('~/code/app')
    expect(second).toEqual(first)
    expect(listGroups()).toHaveLength(1)
  })

  it('is guarded by a unique index, not just by the check', () => {
    // A duplicate slipping past ensureGroupForRepo would break §4's
    // one-group-per-repo rule everywhere downstream.
    ensureGroupForRepo('~/code/app')
    expect(() => db.insert(groups).values({ id: 'dupe', repoPath: '~/code/app' }).run()).toThrow()
  })
})

describe('repo trust', () => {
  it('starts closed, which is the only safe default', () => {
    // Every Contact begins trusting nothing its repository says. A clone of
    // somebody else's project should not be able to instruct a persona because
    // a human once pointed a Contact at it.
    const contact = createContact(draft('~/code/app', 'Reviewer · app'))
    expect(contact.repoTrust).toBeNull()
  })

  it('records instructions and skills separately', () => {
    // Two different grants. Trusting a repo's CLAUDE.md is not the same as
    // letting it hand the model executable skills, and a UI that offered one
    // switch for both would be making that decision on the user's behalf.
    const contact = createContact(draft('~/code/app', 'Reviewer · app'))
    const trusted = setRepoTrust(contact.id, { instructions: true, skills: ['release-notes'] })

    expect(trusted.repoTrust).toEqual({ instructions: true, skills: ['release-notes'] })
    expect(getContact(contact.id)?.repoTrust).toEqual(trusted.repoTrust)
  })

  it('revokes by writing the closed state, not by deleting the row', () => {
    const contact = createContact(draft('~/code/app', 'Reviewer · app'))
    setRepoTrust(contact.id, { instructions: true, skills: ['release-notes'] })
    const revoked = setRepoTrust(contact.id, { instructions: false, skills: [] })

    expect(revoked.repoTrust).toEqual({ instructions: false, skills: [] })
  })

  it('touches nothing else on the row', () => {
    // Same claim as rename, and the same reason it needs the load-bearing
    // columns actually set: a mutation that nulled backendSessionId on every
    // trust change would pass against a fresh contact where it is already null.
    const contact = createContact({
      personaTemplateId: PERSONA_ID,
      repoPath: '~/code/app',
      displayName: 'Code Reviewer · app',
      isolation: 'worktree'
    })
    setBackendSessionId(contact.id, 'session-abc123')
    const before = getContact(contact.id) as Contact

    const after = setRepoTrust(contact.id, { instructions: true, skills: [] })

    expect(after).toEqual({ ...before, repoTrust: { instructions: true, skills: [] } })
  })

  it('refuses a contact that does not exist', () => {
    expect(() => setRepoTrust('nope', { instructions: true, skills: [] })).toThrow(
      /No such contact/
    )
  })
})

describe('rebindPersona', () => {
  const OTHER_PERSONA = 'persona-2'

  function seedOtherPersona(): void {
    db.insert(personaTemplates)
      .values({
        id: OTHER_PERSONA,
        name: 'Refactor Buddy',
        avatarColor: '#eb6834',
        backend: 'codex',
        systemPrompt: '',
        skillIds: [],
        sandbox: 'workspace_write',
        githubScope: 'open_pr'
      })
      .run()
  }

  it('moves the binding and clears the resume key, and nothing else', () => {
    seedOtherPersona()
    const contact = createContact({
      personaTemplateId: PERSONA_ID,
      repoPath: '~/code/app',
      displayName: 'Code Reviewer · app',
      isolation: 'worktree'
    })
    setBackendSessionId(contact.id, 'session-abc123')
    const before = getContact(contact.id) as Contact

    const after = rebindContactPersona(contact.id, OTHER_PERSONA)

    // The whole row, not two fields: repoPath, worktreePath, branch and the
    // display name are all load-bearing and must survive the rebind.
    expect(after).toEqual({
      ...before,
      personaTemplateId: OTHER_PERSONA,
      backendSessionId: null
    })
  })

  it('refuses while a turn is running for this contact', () => {
    seedOtherPersona()
    const contact = createContact(draft('~/code/app', 'Reviewer · app'))
    const release = acquire({
      runId: 'run-1',
      contactId: contact.id,
      contactName: contact.displayName,
      workingPath: '~/code/app',
      mode: 'shared',
      startedAt: 0
    })

    expect(() => rebindContactPersona(contact.id, OTHER_PERSONA)).toThrow(/working right now/)
    // Untouched on refusal.
    expect(getContact(contact.id)?.personaTemplateId).toBe(PERSONA_ID)

    release?.()
    expect(rebindContactPersona(contact.id, OTHER_PERSONA).personaTemplateId).toBe(OTHER_PERSONA)
  })

  it('rejects an unknown persona without touching the contact', () => {
    const contact = createContact(draft('~/code/app', 'Reviewer · app'))
    setBackendSessionId(contact.id, 'session-abc123')

    expect(() => rebindContactPersona(contact.id, 'persona-invented')).toThrow(/No such persona/)
    expect(getContact(contact.id)?.backendSessionId).toBe('session-abc123')
  })

  it('rejects an unknown contact', () => {
    seedOtherPersona()
    expect(() => rebindContactPersona('contact-invented', OTHER_PERSONA)).toThrow(
      /No such contact/
    )
  })
})
