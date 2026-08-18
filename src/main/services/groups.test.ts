import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestDb } from '../db/test-db'
import { personaTemplates } from '../db/schema'
import type { AppDatabase } from '../db/create'

/**
 * Renaming and hiding a group (review §G5).
 *
 * The claims worth executing are the ones about *null*, because in both columns
 * null carries the meaning rather than standing in for a missing value: a null
 * name means "derive it from the repository path", and a null hidden means
 * visible. Both are what an upgraded profile has in every row, so getting them
 * wrong would not look like a bug — it would look like every group being
 * renamed to nothing, or every group disappearing.
 *
 * Against a real `:memory:` database with the checked-in migrations applied, so
 * migration 0021 is exercised on every run rather than assumed.
 */

let db: AppDatabase

vi.mock('../db', () => ({ initDb: () => db }))
vi.mock('electron', () => ({
  app: { getPath: () => '/Users/dev/Library/Application Support/persona-router' }
}))

const { ensureGroupForRepo, listGroups, renameGroup, setGroupHidden } = await import('./groups')

const REPO = '/Users/dev/my-app'

beforeEach(() => {
  db = createTestDb()
  db.insert(personaTemplates)
    .values({
      id: 'persona-1',
      name: 'Code Reviewer',
      avatarColor: '#2a78d6',
      backend: 'claude',
      systemPrompt: 'Review.',
      skillIds: ['s1'],
      sandbox: 'read_only',
      githubScope: 'read_only'
    })
    .run()
})

function seeded(): ReturnType<typeof ensureGroupForRepo> {
  return ensureGroupForRepo(REPO)
}

describe('a group as created', () => {
  // The upgrade shape, and the default for every group anyone has ever had.
  it('starts with no name of its own and is not hidden', () => {
    const group = seeded()
    expect(group.name).toBeNull()
    expect(group.hidden).toBeNull()
  })
})

describe('renameGroup', () => {
  it('stores the name and returns the updated group', () => {
    const group = seeded()
    expect(renameGroup(group.id, 'Checkout').name).toBe('Checkout')
    expect(listGroups()[0].name).toBe('Checkout')
  })

  /**
   * The reset. Null is a real argument rather than a missing one — it is the
   * only way back to the repository's name, which is why the procedure accepts
   * `string | null` instead of needing a second "reset" action beside it.
   */
  it('clears the override with null, rather than storing an empty name', () => {
    const group = seeded()
    renameGroup(group.id, 'Checkout')

    expect(renameGroup(group.id, null).name).toBeNull()
    expect(listGroups()[0].name).toBeNull()
  })

  // Renaming touches the name and nothing else. `repoPath` in particular is the
  // group's identity — every membership lookup is `contacts.repoPath === it`.
  it('leaves the repository path and read boundary alone', () => {
    const group = seeded()
    const renamed = renameGroup(group.id, 'Checkout')

    expect(renamed.repoPath).toBe(REPO)
    expect(renamed.lastReadAt).toBe(group.lastReadAt)
  })

  it('refuses an id that is not a group', () => {
    expect(() => renameGroup('nope', 'Checkout')).toThrow(/No such group/)
  })
})

describe('setGroupHidden', () => {
  it('hides and unhides', () => {
    const group = seeded()
    expect(setGroupHidden(group.id, true).hidden).toBe(true)
    expect(listGroups()[0].hidden).toBe(true)

    expect(setGroupHidden(group.id, false).hidden).toBe(false)
    expect(listGroups()[0].hidden).toBe(false)
  })

  /**
   * Hiding is not deletion, and this is the assertion that says so: the row
   * survives, `listGroups` still returns it, and the read boundary is intact.
   *
   * Deleting instead would not even be durable — a group is a view of the
   * contacts on a repository, so `ensureGroupForRepo` recreates it on the next
   * turn with a fresh `last_read_at`, lighting up every old message as unread.
   */
  it('keeps the row, so nothing is lost and unhiding restores everything', () => {
    const group = seeded()
    setGroupHidden(group.id, true)

    const [row] = listGroups()
    expect(row.id).toBe(group.id)
    expect(row.repoPath).toBe(REPO)
    expect(row.lastReadAt).toBe(group.lastReadAt)
  })

  // Hiding and renaming are independent, which is what makes them two separate
  // procedures rather than one widened update.
  it('does not disturb a name, and a rename does not unhide', () => {
    const group = seeded()
    renameGroup(group.id, 'Checkout')
    expect(setGroupHidden(group.id, true).name).toBe('Checkout')
    expect(renameGroup(group.id, 'Billing').hidden).toBe(true)
  })

  it('refuses an id that is not a group', () => {
    expect(() => setGroupHidden('nope', true)).toThrow(/No such group/)
  })
})

/**
 * The one that would bite in production rather than in a test: a group is
 * created implicitly by `createContact`, and the second contact on a repository
 * must not resurrect a hidden group or overwrite the name someone gave it.
 * `ensureGroupForRepo` uses `onConflictDoNothing`, so this holds — but it holds
 * by a detail of one statement, which is exactly the kind of thing worth
 * pinning.
 */
describe('ensureGroupForRepo on a group that has been customised', () => {
  it('leaves the name and the hidden state as they were', () => {
    const group = seeded()
    renameGroup(group.id, 'Checkout')
    setGroupHidden(group.id, true)

    const again = ensureGroupForRepo(REPO)
    expect(again.id).toBe(group.id)
    expect(again.name).toBe('Checkout')
    expect(again.hidden).toBe(true)
  })
})
