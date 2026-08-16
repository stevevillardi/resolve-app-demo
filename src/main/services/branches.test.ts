import { execFileSync } from 'child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestDb } from '../db/test-db'
import { personaTemplates } from '../db/schema'
import type { AppDatabase } from '../db/create'
import type { Contact } from '../../shared/domain'

/**
 * Layer 3: the part of worktree isolation with a human in it.
 *
 * Against real git, for the same reason git-worktree.test.ts is — the claims
 * here are about what git does (a branch outliving its Contact, a merge landing
 * in one tree and not another), and a mock would only assert the argument lists.
 */

let db: AppDatabase
let scratch: string
let repo: string
let userData: string

vi.mock('../db', () => ({ initDb: () => db }))
vi.mock('electron', () => ({ app: { getPath: () => userData } }))

const { listPersonaBranches, mergeTargetsFor, previewMerge, mergeIntoWorkingPath, discardBranch } =
  await import('./branches')
const { createContact, deleteContact } = await import('./contacts')
const { ensureWorktree } = await import('./worktrees')
const { branchExists } = await import('./git')

const PERSONA_WRITER = 'persona-writer'

function run(args: string[], cwd = repo): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

function commitIn(cwd: string, file: string, contents: string, message: string): void {
  mkdirSync(join(cwd, 'src'), { recursive: true })
  writeFileSync(join(cwd, file), contents)
  run(['add', '-A'], cwd)
  run(['commit', '-m', message], cwd)
}

beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'pr-branches-')))
  userData = join(scratch, 'profile')
  repo = join(scratch, 'my-app')

  execFileSync('git', ['init', '-q', '-b', 'main', repo])
  run(['config', 'user.email', 'test@example.com'])
  run(['config', 'user.name', 'Test'])
  commitIn(repo, 'src/a.ts', 'export const a = 1\n', 'init')

  db = createTestDb()
  db.insert(personaTemplates)
    .values({
      id: PERSONA_WRITER,
      name: 'Refactor Buddy',
      avatarColor: '#c2410c',
      backend: 'claude',
      systemPrompt: '',
      skillIds: [],
      sandbox: 'workspace_write',
      githubScope: 'open_pr'
    })
    .run()
})

afterEach(() => {
  execFileSync('rm', ['-rf', scratch])
})

function writer(displayName = 'Refactor Buddy · my-app'): Contact {
  return createContact({ personaTemplateId: PERSONA_WRITER, repoPath: repo, displayName })
}

/** A contact with a worktree holding one commit nobody else has. */
async function workingWriter(displayName?: string): Promise<Contact> {
  const contact = writer(displayName)
  await ensureWorktree(contact)
  commitIn(contact.worktreePath as string, 'src/b.ts', 'export const b = 2\n', 'buddy work')
  return contact
}

describe('listPersonaBranches', () => {
  it('is empty before anyone has done anything', async () => {
    writer()
    expect(await listPersonaBranches()).toEqual([])
  })

  it('reports the branch, its owner and what it changed', async () => {
    const contact = await workingWriter()

    const [summary] = await listPersonaBranches()

    expect(summary).toMatchObject({
      repoPath: repo,
      branch: contact.branch,
      contactId: contact.id,
      contactName: 'Refactor Buddy · my-app',
      files: ['src/b.ts'],
      hasWorktree: true
    })
  })

  // The reason this reads git rather than the contacts table. A branch outlives
  // the Contact that made it, and those are exactly the ones most at risk of
  // being forgotten — a database-driven list would drop them silently.
  it('still lists a branch whose contact has been deleted', async () => {
    const contact = await workingWriter()
    await deleteContact(contact.id, true)

    const [summary] = await listPersonaBranches()

    expect(summary.branch).toBe(contact.branch)
    expect(summary.contactId).toBeNull()
    expect(summary.contactName).toBeNull()
    expect(summary.hasWorktree).toBe(false)
  })

  it('marks a branch whose checkout the user deleted by hand', async () => {
    const contact = await workingWriter()
    execFileSync('rm', ['-rf', contact.worktreePath as string])

    expect((await listPersonaBranches())[0].hasWorktree).toBe(false)
  })
})

describe('mergeTargetsFor', () => {
  it('offers the user’s checkout and every materialised worktree', async () => {
    const contact = await workingWriter()

    const targets = await mergeTargetsFor(repo)

    expect(targets.map((t) => t.label)).toEqual(['Your checkout', 'Refactor Buddy · my-app'])
    expect(targets.map((t) => t.path)).toContain(contact.worktreePath)
  })

  it('omits a worktree that has not been created yet', async () => {
    writer()
    expect(await mergeTargetsFor(repo)).toHaveLength(1)
  })

  // Reported rather than filtered out: a target that silently vanished would
  // read as a bug, where one labelled "has uncommitted changes" is an answer.
  it('reports a dirty target instead of hiding it', async () => {
    await workingWriter()
    writeFileSync(join(repo, 'src/unsaved.ts'), 'in progress\n')

    expect((await mergeTargetsFor(repo)).find((t) => t.path === repo)?.dirty).toBe(true)
  })
})

describe('previewMerge', () => {
  it('reports a clean merge without touching the target', async () => {
    const contact = await workingWriter()
    const before = run(['rev-parse', 'HEAD'])

    expect(await previewMerge(repo, repo, contact.branch as string)).toEqual({
      clean: true,
      conflicts: []
    })
    expect(run(['rev-parse', 'HEAD'])).toBe(before)
    expect(run(['status', '--porcelain'])).toBe('')
  })

  it('names the conflicted files, still without touching the target', async () => {
    const contact = await workingWriter()
    commitIn(contact.worktreePath as string, 'src/a.ts', 'buddy edit\n', 'buddy edits a')
    commitIn(repo, 'src/a.ts', 'main edit\n', 'main edits a')

    const preview = await previewMerge(repo, repo, contact.branch as string)

    expect(preview.clean).toBe(false)
    expect(preview.conflicts).toEqual(['src/a.ts'])
    expect(readFileSync(join(repo, 'src/a.ts'), 'utf8')).toBe('main edit\n')
  })
})

describe('mergeIntoWorkingPath', () => {
  // The whole point of choosing a target: merging for one persona must not
  // reach into anybody else's tree, least of all the user's.
  it('lands in the chosen tree and nowhere else', async () => {
    const buddy = await workingWriter('Refactor Buddy · my-app')
    const reviewer = writer('Reviewer · my-app')
    await ensureWorktree(reviewer)

    await mergeIntoWorkingPath(reviewer.worktreePath as string, buddy.branch as string)

    expect(existsSync(join(reviewer.worktreePath as string, 'src/b.ts'))).toBe(true)
    expect(existsSync(join(repo, 'src/b.ts'))).toBe(false)
  })

  // "These commits merge cleanly" and "this merge will succeed now" are
  // different claims; the preview answers the first, so this has to check the
  // second rather than assume the preview covered it.
  it('refuses a target with uncommitted changes', async () => {
    const contact = await workingWriter()
    writeFileSync(join(repo, 'src/unsaved.ts'), 'in progress\n')

    await expect(mergeIntoWorkingPath(repo, contact.branch as string)).rejects.toThrow(
      /uncommitted changes/i
    )
  })
})

describe('discardBranch', () => {
  it('refuses to drop unmerged work unless forced', async () => {
    const contact = await workingWriter()
    // The worktree still holds the branch; removing it is what frees the ref.
    await deleteContact(contact.id, true)

    await expect(discardBranch(repo, contact.branch as string)).rejects.toThrow(/not fully merged/i)
    expect(await branchExists(repo, contact.branch as string)).toBe(true)

    await discardBranch(repo, contact.branch as string, true)
    expect(await branchExists(repo, contact.branch as string)).toBe(false)
  })
})
