import { existsSync } from 'fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestDb } from '../db/test-db'
import {
  auditEvents,
  groups,
  messages,
  personaTemplates,
  routines,
  usageEvents
} from '../db/schema'
import type { AppDatabase } from '../db/create'
import type { Contact } from '../../shared/domain'

/**
 * The invariant under test is one Group per repo. A Contact is the only thing
 * that creates a Group, so it has to hold from the very first contact bound to
 * a path — not be reconciled later.
 */

let db: AppDatabase

vi.mock('../db', () => ({ initDb: () => db }))
// createContact plans a writer's worktree path, which is rooted in the profile
// directory — the only thing this test needs Electron for.
vi.mock('electron', () => ({
  app: { getPath: () => '/Users/dev/Library/Application Support/persona-router' }
}))
// agent-events imports `electron`'s BrowserWindow, which this test's minimal
// electron mock has no reason to provide. The audit rows themselves are
// asserted directly against the database below; agent-events' own push
// behaviour is audit-events.test.ts's business, not this file's.
vi.mock('./agent-events', () => ({ emitAuditChanged: (): void => {} }))

const {
  createContact,
  deleteContact,
  getContact,
  listContacts,
  rebindContactPersona,
  recreateContact,
  renameContact,
  markContactRead,
  setBackendSessionId,
  setContactIsolation,
  setContactModel,
  setRepoTrust,
  startFreshSession
} = await import('./contacts')
const { ensureGroupForRepo, listGroups, markGroupRead } = await import('./groups')
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
    // backendSessionId is a resume key, and there is nothing to resume until a
    // turn has actually run.
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
    // Renaming a fresh contact would not do it: its backendSessionId and
    // worktreePath are both null, so a mutation that nulled them on every
    // rename would pass. A row where every load-bearing column is already null
    // cannot detect a function that clears them.
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
    expect(() => renameContact('nope', 'Reviewer')).toThrow(/no longer exists/)
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
    // A duplicate slipping past ensureGroupForRepo would break the
    // one-group-per-repo rule everywhere downstream.
    ensureGroupForRepo('~/code/app')
    expect(() => db.insert(groups).values({ id: 'dupe', repoPath: '~/code/app' }).run()).toThrow()
  })
})

describe('read state', () => {
  it('is born read — a new thread has nothing unread in it', () => {
    const contact = createContact(draft('~/code/app', 'Code Reviewer · app'))
    expect(contact.lastReadAt).not.toBeNull()
    expect(getContact(contact.id)?.lastReadAt).toBe(contact.lastReadAt)
  })

  it('marks read forward and round-trips', () => {
    const contact = createContact(draft('~/code/app', 'Code Reviewer · app'))
    const later = (contact.lastReadAt as number) + 60_000

    const updated = markContactRead(contact.id, later)

    expect(updated.lastReadAt).toBe(later)
    expect(getContact(contact.id)?.lastReadAt).toBe(later)
  })

  // Two mounted views can race their mark-read effects; the losing write must
  // not resurrect read messages as unread.
  it('never moves the boundary backwards', () => {
    const contact = createContact(draft('~/code/app', 'Code Reviewer · app'))
    const later = (contact.lastReadAt as number) + 60_000
    markContactRead(contact.id, later)

    markContactRead(contact.id, later - 30_000)

    expect(getContact(contact.id)?.lastReadAt).toBe(later)
  })

  it('groups carry the same contract, including birth', () => {
    const group = ensureGroupForRepo('~/code/app')
    expect(group.lastReadAt).not.toBeNull()

    const later = (group.lastReadAt as number) + 60_000
    expect(markGroupRead(group.id, later).lastReadAt).toBe(later)
    expect(markGroupRead(group.id, later - 1).lastReadAt).toBe(later)
  })

  it('refuses an unknown id rather than inventing a row', () => {
    expect(() => markContactRead('nope')).toThrow(/no longer exists/)
    expect(() => markGroupRead('nope')).toThrow(/no longer exists/)
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
      /no longer exists/
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
      startedAt: 0,
      origin: { kind: 'message' }
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

    expect(() => rebindContactPersona(contact.id, 'persona-invented')).toThrow(/no longer exists/)
    expect(getContact(contact.id)?.backendSessionId).toBe('session-abc123')
  })

  it('rejects an unknown contact', () => {
    seedOtherPersona()
    expect(() => rebindContactPersona('contact-invented', OTHER_PERSONA)).toThrow(
      /no longer exists/
    )
  })
})

describe('recreateContact', () => {
  /**
   * What this exists to prevent: `messages` is ON DELETE CASCADE, so recreating
   * a contact to change the one immutable thing left — its repo — would trade a
   * month of conversation for a path.
   */
  function seedThread(contactId: string, ids: string[]): void {
    for (const id of ids) {
      db.insert(messages)
        .values({
          id,
          contactId,
          role: 'user',
          content: `said ${id}`,
          timestamp: new Date(1_786_800_000_000)
        })
        .run()
    }
  }

  it('moves the whole conversation to the replacement', async () => {
    const original = createContact(draft('~/code/app', 'Reviewer · app'))
    seedThread(original.id, ['m1', 'm2', 'm3'])

    const replacement = await recreateContact(
      original.id,
      draft('~/code/moved', 'Reviewer · moved'),
      true
    )

    expect(replacement.id).not.toBe(original.id)
    expect(replacement.repoPath).toBe('~/code/moved')
    const moved = db.select().from(messages).all()
    expect(moved).toHaveLength(3)
    expect(moved.every((row) => row.contactId === replacement.id)).toBe(true)
  })

  it('replaces the original rather than leaving two behind', async () => {
    const original = createContact(draft('~/code/app', 'Reviewer · app'))
    await recreateContact(original.id, draft('~/code/moved', 'Reviewer · moved'), true)

    expect(getContact(original.id)).toBeNull()
    expect(listContacts()).toHaveLength(1)
  })

  // A genuinely fresh start is a reasonable want, and should not require
  // deleting the contact twice to get.
  it('leaves the history behind when asked to', async () => {
    const original = createContact(draft('~/code/app', 'Reviewer · app'))
    seedThread(original.id, ['m1', 'm2'])

    await recreateContact(original.id, draft('~/code/moved', 'Reviewer · moved'), false)

    // Cascaded away with the contact, which is what not bringing it means.
    expect(db.select().from(messages).all()).toHaveLength(0)
  })

  // A 3am job written against one repository firing unattended against another
  // is the surprise this app exists not to produce. Deleting them silently is
  // no better, so they survive switched off for a human to re-arm.
  it('brings routines across disabled', async () => {
    const original = createContact(draft('~/code/app', 'Reviewer · app'))
    db.insert(routines)
      .values({
        id: 'r1',
        contactId: original.id,
        schedule: '0 9 * * *',
        prompt: 'check the overnight commits',
        enabled: true
      })
      .run()

    const replacement = await recreateContact(
      original.id,
      draft('~/code/moved', 'Reviewer · moved'),
      true
    )

    const moved = db.select().from(routines).all()
    expect(moved).toHaveLength(1)
    expect(moved[0].contactId).toBe(replacement.id)
    expect(moved[0].enabled).toBe(false)
  })

  // Usage rows outlive the contact that produced them so a total covering last
  // month cannot shrink when somebody tidies up this month. Re-pointing them
  // would move money the old contact really did spend.
  it('leaves spend attributed to the contact that spent it', async () => {
    const original = createContact(draft('~/code/app', 'Reviewer · app'))
    db.insert(usageEvents)
      .values({
        id: 'u1',
        contactId: original.id,
        personaTemplateId: PERSONA_ID,
        repoPath: '~/code/app',
        timestamp: new Date(1_786_800_000_000),
        source: 'message',
        inputTokens: 100,
        outputTokens: 10
      })
      .run()

    const replacement = await recreateContact(
      original.id,
      draft('~/code/moved', 'Reviewer · moved'),
      true
    )

    const spend = db.select().from(usageEvents).all()
    expect(spend).toHaveLength(1)
    expect(spend[0].contactId).not.toBe(replacement.id)
    // Orphaned rather than moved, and still carrying what it was spent on.
    expect(spend[0].repoPath).toBe('~/code/app')
  })

  it('refuses while the original is mid-turn, and changes nothing', async () => {
    const original = createContact(draft('~/code/app', 'Reviewer · app'))
    seedThread(original.id, ['m1'])
    const release = acquire({
      runId: 'run-1',
      contactId: original.id,
      contactName: original.displayName,
      workingPath: '~/code/app',
      mode: 'exclusive',
      startedAt: 0,
      origin: { kind: 'message' }
    })

    await expect(
      recreateContact(original.id, draft('~/code/moved', 'Reviewer · moved'), true)
    ).rejects.toThrow(/working right now/)

    // No replacement created, and the thread still where it was.
    expect(listContacts()).toHaveLength(1)
    expect(db.select().from(messages).all()[0].contactId).toBe(original.id)

    release?.()
  })

  it('rejects an unknown original', async () => {
    await expect(
      recreateContact('contact-invented', draft('~/code/moved', 'X'), true)
    ).rejects.toThrow(/no longer exists/)
  })
})

describe('setContactIsolation', () => {
  /**
   * Isolation looks like it has to be immutable, on the grounds that a real
   * checkout on disk points at it. ensureWorktree makes that false — the
   * checkout is created on the first writing turn, not at bind time — so the
   * row is the durable thing and the disk follows it.
   */
  it('plans a worktree when a shared contact becomes isolated', async () => {
    const contact = createContact({ ...draft('~/code/app', 'Reviewer · app'), isolation: 'shared' })
    expect(contact.worktreePath).toBeNull()

    const isolated = await setContactIsolation(contact.id, 'worktree')

    expect(isolated.isolation).toBe('worktree')
    expect(isolated.worktreePath).toContain('worktrees')
    expect(isolated.branch).toMatch(/^persona\//)
  })

  // Nothing is created on disk here, and that is the point: ensureWorktree
  // materialises it on the next writing turn, exactly as it does for a contact
  // that was isolated at bind time.
  it('creates nothing on disk — the next turn does that', async () => {
    const contact = createContact({ ...draft('~/code/app', 'Reviewer · app'), isolation: 'shared' })
    const isolated = await setContactIsolation(contact.id, 'worktree')
    expect(existsSync(isolated.worktreePath as string)).toBe(false)
  })

  it('keeps the branch when a contact stops being isolated', async () => {
    const contact = createContact({
      ...draft('~/code/app', 'Reviewer · app'),
      isolation: 'worktree'
    })
    const branch = contact.branch

    const shared = await setContactIsolation(contact.id, 'shared')

    expect(shared.isolation).toBe('shared')
    expect(shared.worktreePath).toBeNull()
    // git worktree remove leaves the commits, and the Branches panel matches a
    // branch to its Contact by this column — nulling it would orphan that
    // Contact's own committed work the moment it de-isolated.
    expect(shared.branch).toBe(branch)
  })

  // plannedWorktree is deterministic from (repo, persona, contact id) and
  // worktreeAdd reuses an existing branch, so a round trip lands back on the
  // same work rather than stranding it on a branch nobody points at.
  it('returns to the same branch on a round trip', async () => {
    const contact = createContact({
      ...draft('~/code/app', 'Reviewer · app'),
      isolation: 'worktree'
    })
    const original = { path: contact.worktreePath, branch: contact.branch }

    await setContactIsolation(contact.id, 'shared')
    const again = await setContactIsolation(contact.id, 'worktree')

    expect(again.worktreePath).toBe(original.path)
    expect(again.branch).toBe(original.branch)
  })

  // The session was opened against a working directory that no longer applies.
  // Same reasoning as rebindContactPersona — and the thread draws a divider
  // where it happens, so the consequence is visible.
  it('clears the resume key in both directions', async () => {
    const contact = createContact({ ...draft('~/code/app', 'Reviewer · app'), isolation: 'shared' })
    setBackendSessionId(contact.id, 'session-abc')
    expect((await setContactIsolation(contact.id, 'worktree')).backendSessionId).toBeNull()

    setBackendSessionId(contact.id, 'session-def')
    expect((await setContactIsolation(contact.id, 'shared')).backendSessionId).toBeNull()
  })

  it('is a no-op when the isolation already matches', async () => {
    const contact = createContact({ ...draft('~/code/app', 'Reviewer · app'), isolation: 'shared' })
    setBackendSessionId(contact.id, 'session-abc')

    // Not even the session is cleared: nothing moved, so nothing was invalidated.
    expect((await setContactIsolation(contact.id, 'shared')).backendSessionId).toBe('session-abc')
  })

  // Load-bearing rather than defensive: the run lock is keyed on
  // workingPathFor(contact), so moving that under a holder leaves its release
  // looking for a slot that no longer exists.
  it('refuses while that contact is mid-turn, and moves nothing', async () => {
    const contact = createContact({ ...draft('~/code/app', 'Reviewer · app'), isolation: 'shared' })
    const release = acquire({
      runId: 'run-1',
      contactId: contact.id,
      contactName: contact.displayName,
      workingPath: '~/code/app',
      mode: 'exclusive',
      startedAt: 0,
      origin: { kind: 'message' }
    })

    await expect(setContactIsolation(contact.id, 'worktree')).rejects.toThrow(/working right now/)
    expect(getContact(contact.id)?.worktreePath).toBeNull()
    expect(getContact(contact.id)?.isolation).toBe('shared')

    release?.()
    expect((await setContactIsolation(contact.id, 'worktree')).isolation).toBe('worktree')
  })

  it('rejects an unknown contact', async () => {
    await expect(setContactIsolation('contact-invented', 'worktree')).rejects.toThrow(
      /no longer exists/
    )
  })
})

describe('startFreshSession', () => {
  it('drops the resume key and keeps everything else', () => {
    const contact = createContact(draft('~/code/app', 'Reviewer · app'))
    setBackendSessionId(contact.id, 'session-abc123')

    const after = startFreshSession(contact.id)

    expect(after.backendSessionId).toBeNull()
    // The point of the action is what it does NOT change: the conversation is
    // ours, and only the backend's memory of it is being dropped.
    expect(after).toEqual({ ...getContact(contact.id), backendSessionId: null })
    expect(after.repoPath).toBe(contact.repoPath)
    expect(after.personaTemplateId).toBe(contact.personaTemplateId)
    expect(after.worktreePath).toBe(contact.worktreePath)
    expect(after.branch).toBe(contact.branch)
  })

  // A contact that has never run a turn already has what this offers, so
  // asking again is not an error — the menu item is disabled there anyway.
  it('is a no-op on a contact with no session', () => {
    const contact = createContact(draft('~/code/app', 'Reviewer · app'))
    expect(startFreshSession(contact.id).backendSessionId).toBeNull()
  })

  // Same race as the persona backend switch: a turn finishing a moment later
  // writes its own session id back over the clear, so without this the request
  // would report success and silently not happen.
  it('refuses while that contact is mid-turn, and clears nothing', () => {
    const contact = createContact(draft('~/code/app', 'Reviewer · app'))
    setBackendSessionId(contact.id, 'session-abc123')
    const release = acquire({
      runId: 'run-1',
      contactId: contact.id,
      contactName: contact.displayName,
      workingPath: '~/code/app',
      mode: 'exclusive',
      startedAt: 0,
      origin: { kind: 'message' }
    })

    expect(() => startFreshSession(contact.id)).toThrow(/working right now/)
    expect(getContact(contact.id)?.backendSessionId).toBe('session-abc123')

    release?.()
    expect(startFreshSession(contact.id).backendSessionId).toBeNull()
  })

  it('rejects an unknown contact', () => {
    expect(() => startFreshSession('contact-invented')).toThrow(/no longer exists/)
  })
})

/**
 * The other direction of the run lock: a turn is in flight, and something
 * outside the turn loop wants to change the ground under it. The lock cannot
 * see these, because none of them takes it.
 */
describe('deleteContact under a running turn', () => {
  it('refuses, and the contact is still there afterwards', async () => {
    const contact = createContact(draft('~/code/app', 'Reviewer · app'))
    const release = acquire({
      runId: 'run-1',
      contactId: contact.id,
      contactName: contact.displayName,
      workingPath: '~/code/app',
      mode: 'exclusive',
      startedAt: 0,
      origin: { kind: 'message' }
    })

    await expect(deleteContact(contact.id)).rejects.toThrow(/working right now/)
    // The point of the guard is the write that does not happen: the row is
    // what its own turn is about to insert a reply against.
    expect(getContact(contact.id)).not.toBeNull()

    release?.()
    await expect(deleteContact(contact.id)).resolves.toBe(true)
    expect(getContact(contact.id)).toBeNull()
  })

  // A turn on somebody else is not this contact's problem — the guard is per
  // contact, not a global freeze.
  it('allows the delete while a different contact is working', async () => {
    const target = createContact(draft('~/code/app', 'Reviewer · app'))
    const busy = createContact(draft('~/code/other', 'Writer · other'))
    acquire({
      runId: 'run-2',
      contactId: busy.id,
      contactName: busy.displayName,
      workingPath: '~/code/other',
      mode: 'exclusive',
      startedAt: 0,
      origin: { kind: 'message' }
    })

    await expect(deleteContact(target.id)).resolves.toBe(true)
  })

  it('names the contact that is in the way', async () => {
    const contact = createContact(draft('~/code/app', 'Reviewer · app'))
    acquire({
      runId: 'run-3',
      contactId: contact.id,
      contactName: contact.displayName,
      workingPath: '~/code/app',
      mode: 'exclusive',
      startedAt: 0,
      origin: { kind: 'message' }
    })

    await expect(deleteContact(contact.id)).rejects.toThrow(/Reviewer · app is working/)
  })
})

describe('audit trail', () => {
  function auditActions(): string[] {
    return db
      .select()
      .from(auditEvents)
      .all()
      .map((row) => row.action)
  }

  it('records contact_created', () => {
    createContact(draft('~/code/app', 'Reviewer · app'))
    expect(auditActions()).toEqual(['contact_created'])
  })

  it('records contact_renamed', () => {
    const contact = createContact(draft('~/code/app', 'Reviewer · app'))
    renameContact(contact.id, 'Senior Reviewer')
    expect(auditActions()).toEqual(['contact_created', 'contact_renamed'])
  })

  it('records contact_deleted, with the contact still resolvable at insert time', async () => {
    const contact = createContact(draft('~/code/app', 'Reviewer · app'))
    await deleteContact(contact.id)

    const rows = db.select().from(auditEvents).all()
    const deleted = rows.find((row) => row.action === 'contact_deleted')
    expect(deleted?.contactId).toBeNull() // set null once the row it named is gone
    expect(deleted?.repoPath).toBe('~/code/app')
  })

  it('records contact_model_changed', () => {
    const contact = createContact(draft('~/code/app', 'Reviewer · app'))
    setContactModel(contact.id, 'claude-opus-4')
    expect(auditActions()).toEqual(['contact_created', 'contact_model_changed'])
  })

  it('records contact_repo_trust_changed', () => {
    const contact = createContact(draft('~/code/app', 'Reviewer · app'))
    setRepoTrust(contact.id, { instructions: true, skills: [] })
    expect(auditActions()).toEqual(['contact_created', 'contact_repo_trust_changed'])
  })

  it('records contact_persona_rebound', () => {
    db.insert(personaTemplates)
      .values({
        id: 'persona-2',
        name: 'Second Persona',
        avatarColor: '#000000',
        backend: 'claude',
        systemPrompt: '',
        skillIds: [],
        sandbox: 'read_only',
        githubScope: 'read_only'
      })
      .run()
    const contact = createContact(draft('~/code/app', 'Reviewer · app'))
    rebindContactPersona(contact.id, 'persona-2')
    expect(auditActions()).toEqual(['contact_created', 'contact_persona_rebound'])
  })

  it('records contact_recreated', async () => {
    const original = createContact(draft('~/code/app', 'Reviewer · app'))
    await recreateContact(original.id, draft('~/code/app', 'Reviewer · app v2'), false)
    // createContact fires once for the original and once for the replacement.
    expect(auditActions()).toEqual(['contact_created', 'contact_created', 'contact_recreated'])
  })

  it('records contact_session_reset', () => {
    const contact = createContact(draft('~/code/app', 'Reviewer · app'))
    setBackendSessionId(contact.id, 'session-1')
    startFreshSession(contact.id)
    expect(auditActions()).toEqual(['contact_created', 'contact_session_reset'])
  })

  it('records contact_isolation_changed only when the isolation actually changes', async () => {
    db.insert(personaTemplates)
      .values({
        id: 'persona-writer',
        name: 'Writer',
        avatarColor: '#000000',
        backend: 'claude',
        systemPrompt: '',
        skillIds: [],
        sandbox: 'workspace_write',
        githubScope: 'read_only'
      })
      .run()
    const contact = createContact({
      personaTemplateId: 'persona-writer',
      repoPath: '~/code/app',
      displayName: 'Writer · app'
    })

    // A no-op call — already 'worktree' — must not add a row.
    await setContactIsolation(contact.id, 'worktree')
    expect(auditActions()).toEqual(['contact_created'])

    await setContactIsolation(contact.id, 'shared')
    expect(auditActions()).toEqual(['contact_created', 'contact_isolation_changed'])
  })

  it('stamps a routine actor when one is passed through', () => {
    const contact = createContact(draft('~/code/app', 'Reviewer · app'), {
      kind: 'routine',
      routineId: 'routine-1'
    })
    const [row] = db.select().from(auditEvents).all()
    expect(row.actorKind).toBe('routine')
    expect(row.actorRoutineId).toBe('routine-1')
    expect(contact.displayName).toBe('Reviewer · app')
  })
})
