import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createTestDb } from '../db/test-db'
import { contacts, groups, personaTemplates } from '../db/schema'
import type { AppDatabase } from '../db/create'

/**
 * The dev reset (Phase 18). The claims worth pinning: contacts leave through
 * the real deleteContact path (so real repos keep clean worktree registries),
 * persona branches are force-deleted, the profile is wiped, and everything
 * the app does not own is left exactly alone.
 */

let db: AppDatabase
let userData: string
let closeDbCalls = 0

vi.mock('electron', () => ({
  app: { getPath: () => userData }
}))

vi.mock('../db', () => ({
  initDb: () => db,
  closeDb: () => {
    closeDbCalls += 1
  },
  DB_FILE_NAME: 'switchboard.db'
}))

const deleteBranchCalls: Array<{ repoPath: string; branch: string; force: boolean | undefined }> =
  []
let deleteBranchImpl: () => Promise<void> = async () => {}

vi.mock('./git', () => ({
  worktreeRemove: async () => {},
  deleteBranch: async (repoPath: string, branch: string, force?: boolean) => {
    deleteBranchCalls.push({ repoPath, branch, force })
    return deleteBranchImpl()
  }
}))

const { clearAppData } = await import('./reset')

function seedContact(id: string, branch: string | null): void {
  db.insert(contacts)
    .values({
      id,
      personaTemplateId: 'p1',
      repoPath: '~/code/app',
      displayName: `${id} · app`,
      backendSessionId: null,
      ...(branch ? { branch } : {})
    })
    .run()
}

beforeEach(() => {
  db = createTestDb()
  userData = mkdtempSync(join(tmpdir(), 'reset-test-'))
  closeDbCalls = 0
  deleteBranchCalls.length = 0
  deleteBranchImpl = async () => {}

  db.insert(groups).values({ id: 'g1', repoPath: '~/code/app' }).run()
  db.insert(personaTemplates)
    .values({
      id: 'p1',
      name: 'Reviewer',
      avatarColor: '#2a78d6',
      backend: 'claude',
      systemPrompt: '',
      skillIds: [],
      sandbox: 'read_only',
      githubScope: 'read_only'
    })
    .run()
})

afterEach(() => {
  rmSync(userData, { recursive: true, force: true })
})

describe('clearAppData', () => {
  it('wipes the profile: database files, secrets, worktrees', async () => {
    for (const name of ['switchboard.db', 'switchboard.db-wal', 'switchboard.db-shm']) {
      writeFileSync(join(userData, name), 'x')
    }
    mkdirSync(join(userData, 'secrets'))
    writeFileSync(join(userData, 'secrets', 'github_token.bin'), 'cipher')
    mkdirSync(join(userData, 'worktrees', 'app'), { recursive: true })

    await clearAppData()

    for (const name of ['switchboard.db', 'switchboard.db-wal', 'switchboard.db-shm']) {
      expect(existsSync(join(userData, name))).toBe(false)
    }
    expect(existsSync(join(userData, 'secrets'))).toBe(false)
    expect(existsSync(join(userData, 'worktrees'))).toBe(false)
  })

  it('closes the database before the files go', async () => {
    // Deleting an open db leaks an fd on macOS and fails on Windows.
    await clearAppData()
    expect(closeDbCalls).toBe(1)
  })

  it('leaves things it does not own alone', async () => {
    // A stray file in the profile it did not create, standing in for anything
    // unexpected — reset enumerates what it owns rather than rm -rf userData.
    writeFileSync(join(userData, 'unrelated.txt'), 'keep me')

    await clearAppData()

    expect(existsSync(join(userData, 'unrelated.txt'))).toBe(true)
  })

  it('deletes every contact through the real path, then its branch, forced', async () => {
    seedContact('c1', 'persona/reviewer-1234')
    seedContact('c2', null)

    await clearAppData()

    expect(db.select().from(contacts).all()).toEqual([])
    // One branch existed; the branchless contact must not produce a call.
    expect(deleteBranchCalls).toEqual([
      { repoPath: '~/code/app', branch: 'persona/reviewer-1234', force: true }
    ])
  })

  it('keeps going when a branch cannot be deleted', async () => {
    // A branch that never materialized (no turn ran) throws from git; that is
    // the clean state we wanted, not a reason to abandon the reset.
    seedContact('c1', 'persona/never-materialized')
    seedContact('c2', 'persona/real-branch')
    let calls = 0
    deleteBranchImpl = async () => {
      calls += 1
      if (calls === 1) throw new Error('branch not found')
    }

    await clearAppData()

    expect(db.select().from(contacts).all()).toEqual([])
    expect(deleteBranchCalls).toHaveLength(2)
  })
})
