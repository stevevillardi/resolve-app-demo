import { execFileSync } from 'child_process'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestDb } from '../db/test-db'
import { contacts, personaTemplates } from '../db/schema'
import type { AppDatabase } from '../db/create'
import type { Contact } from '../../shared/domain'

/**
 * The half of the worktree service that touches git and the database at once:
 * materialising a Contact's checkout, cleaning it up, and recovering from a user
 * who deleted it by hand.
 *
 * Separate from worktrees.test.ts because that file is pure — naming a path
 * needs neither a repo nor a profile — and mixing the two would make the fast
 * tests wait on git.
 */

let db: AppDatabase
let scratch: string
let repo: string
let userData: string

vi.mock('../db', () => ({ initDb: () => db }))
vi.mock('electron', () => ({ app: { getPath: () => userData } }))

const { ensureWorktree, pruneOrphanedWorktrees, recordOfWork, siblingBranchesFor } =
  await import('./worktrees')
const { createContact, deleteContact } = await import('./contacts')
const { branchExists, worktreeList } = await import('./git')

const PERSONA_WRITER = 'persona-writer'
const PERSONA_READER = 'persona-reader'

function run(args: string[], cwd = repo): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'pr-wt-life-')))
  userData = join(scratch, 'profile')
  repo = join(scratch, 'my-app')

  execFileSync('git', ['init', '-q', '-b', 'main', repo])
  run(['config', 'user.email', 'test@example.com'])
  run(['config', 'user.name', 'Test'])
  mkdirSync(join(repo, 'src'), { recursive: true })
  writeFileSync(join(repo, 'src/a.ts'), 'export const a = 1\n')
  run(['add', '-A'])
  run(['commit', '-m', 'init'])

  db = createTestDb()
  for (const [id, name, sandbox] of [
    [PERSONA_WRITER, 'Refactor Buddy', 'workspace_write'],
    [PERSONA_READER, 'Code Reviewer', 'read_only']
  ] as const) {
    db.insert(personaTemplates)
      .values({
        id,
        name,
        avatarColor: '#2a78d6',
        backend: 'claude',
        systemPrompt: '',
        skillIds: [],
        sandbox,
        githubScope: 'read_only'
      })
      .run()
  }
})

afterEach(() => {
  execFileSync('rm', ['-rf', scratch])
})

function writer(displayName = 'Refactor Buddy · my-app'): Contact {
  return createContact({ personaTemplateId: PERSONA_WRITER, repoPath: repo, displayName })
}

describe('ensureWorktree', () => {
  it('creates the checkout the row already named', async () => {
    const contact = writer()
    expect(existsSync(contact.worktreePath!)).toBe(false)

    await ensureWorktree(contact)

    expect(existsSync(join(contact.worktreePath!, 'src/a.ts'))).toBe(true)
    expect(run(['rev-parse', '--abbrev-ref', 'HEAD'], contact.worktreePath!)).toBe(contact.branch)
  })

  it('returns the git directories the sandbox has to grant', async () => {
    const contact = writer()

    const paths = await ensureWorktree(contact)

    // Every one of them is outside the working directory — the finding this
    // whole phase turns on.
    expect(paths.length).toBeGreaterThan(0)
    expect(paths.every((path) => !path.startsWith(contact.worktreePath!))).toBe(true)
  })

  it('is idempotent, so an existing worktree is reused rather than rebuilt', async () => {
    const contact = writer()
    await ensureWorktree(contact)
    writeFileSync(join(contact.worktreePath!, 'src/scratch.ts'), 'in progress\n')

    await ensureWorktree(contact)

    // Work in progress survives a second turn. Rebuilding would discard it.
    expect(existsSync(join(contact.worktreePath!, 'src/scratch.ts'))).toBe(true)
  })

  it('does nothing at all for a contact in the main tree', async () => {
    const reader = createContact({
      personaTemplateId: PERSONA_READER,
      repoPath: repo,
      displayName: 'Code Reviewer · my-app'
    })

    expect(await ensureWorktree(reader)).toEqual([])
    expect(await worktreeList(repo)).toHaveLength(1)
  })

  // Two writers on one repo, which is the contention this phase exists to end.
  it('gives two writers separate checkouts of the same repo', async () => {
    const a = writer('Refactor Buddy · my-app')
    const b = writer('Refactor Buddy 2 · my-app')

    await ensureWorktree(a)
    await ensureWorktree(b)

    writeFileSync(join(a.worktreePath!, 'only-a.ts'), 'a\n')

    expect(existsSync(join(b.worktreePath!, 'only-a.ts'))).toBe(false)
    expect(existsSync(join(repo, 'only-a.ts'))).toBe(false)
    expect(await worktreeList(repo)).toHaveLength(3)
  })

  // Quietly falling back to the main tree would put a Contact the user isolated
  // on purpose back in the directory they were protecting — and the run lock
  // would not know, because the lock key was decided from the row.
  it('fails loudly rather than falling back to the main tree', async () => {
    const contact = writer()
    execFileSync('rm', ['-rf', repo])

    await expect(ensureWorktree(contact)).rejects.toThrow()
  })
})

describe('pruneOrphanedWorktrees', () => {
  it('clears a registration the user orphaned, keeping the branch', async () => {
    const contact = writer()
    await ensureWorktree(contact)
    execFileSync('rm', ['-rf', contact.worktreePath!])

    await pruneOrphanedWorktrees()

    expect(await worktreeList(repo)).toHaveLength(1)
    expect(await branchExists(repo, contact.branch!)).toBe(true)
  })

  // The reason this runs at startup: while a stale registration exists git
  // considers the branch checked out, so re-creating the worktree would fail
  // over a directory the user already deleted.
  it('lets the contact rebuild its worktree on the next turn', async () => {
    const contact = writer()
    await ensureWorktree(contact)
    writeFileSync(join(contact.worktreePath!, 'src/b.ts'), 'export const b = 2\n')
    run(['add', '-A'], contact.worktreePath!)
    run(['commit', '-m', 'buddy work'], contact.worktreePath!)
    execFileSync('rm', ['-rf', contact.worktreePath!])

    await pruneOrphanedWorktrees()
    await ensureWorktree(contact)

    // Rebuilt onto the same branch, so the committed work comes back with it.
    expect(existsSync(join(contact.worktreePath!, 'src/b.ts'))).toBe(true)
  })

  it('survives a repo that has been moved or unmounted', async () => {
    const contact = writer()
    await ensureWorktree(contact)
    execFileSync('rm', ['-rf', repo])

    await expect(pruneOrphanedWorktrees()).resolves.toBeUndefined()
  })

  it('asks nothing of git when no contact is isolated', async () => {
    createContact({
      personaTemplateId: PERSONA_READER,
      repoPath: repo,
      displayName: 'Code Reviewer · my-app'
    })

    await expect(pruneOrphanedWorktrees()).resolves.toBeUndefined()
  })
})

describe('deleteContact', () => {
  it('removes the worktree along with the row', async () => {
    const contact = writer()
    await ensureWorktree(contact)

    expect(await deleteContact(contact.id)).toBe(true)

    expect(existsSync(contact.worktreePath!)).toBe(false)
    expect(await worktreeList(repo)).toHaveLength(1)
    expect(db.select().from(contacts).all()).toHaveLength(0)
  })

  // Committed work is recoverable from the branch; the Branches panel is where
  // a human decides what to do with it.
  it('leaves the branch behind, so committed work is not destroyed', async () => {
    const contact = writer()
    await ensureWorktree(contact)
    writeFileSync(join(contact.worktreePath!, 'src/b.ts'), 'export const b = 2\n')
    run(['add', '-A'], contact.worktreePath!)
    run(['commit', '-m', 'buddy work'], contact.worktreePath!)

    await deleteContact(contact.id)

    expect(await branchExists(repo, contact.branch!)).toBe(true)
  })

  // Uncommitted changes exist nowhere else. Discarding them silently on a
  // delete that was only meant to tidy up a Contact is not recoverable.
  it('refuses when the worktree has unsaved changes', async () => {
    const contact = writer()
    await ensureWorktree(contact)
    writeFileSync(join(contact.worktreePath!, 'src/unsaved.ts'), 'in progress\n')

    await expect(deleteContact(contact.id)).rejects.toThrow(/modified or untracked/i)
    expect(db.select().from(contacts).all()).toHaveLength(1)
  })

  it('discards them when the caller says it asked', async () => {
    const contact = writer()
    await ensureWorktree(contact)
    writeFileSync(join(contact.worktreePath!, 'src/unsaved.ts'), 'in progress\n')

    expect(await deleteContact(contact.id, true)).toBe(true)
    expect(existsSync(contact.worktreePath!)).toBe(false)
  })

  it('deletes a contact whose worktree was never materialised', async () => {
    const contact = writer()

    expect(await deleteContact(contact.id)).toBe(true)
    expect(db.select().from(contacts).all()).toHaveLength(0)
  })

  it('reports an unknown id rather than throwing', async () => {
    expect(await deleteContact('no-such-contact')).toBe(false)
  })
})

describe('recordOfWork', () => {
  it('reports nothing for a contact in the main tree', async () => {
    const reader = createContact({
      personaTemplateId: PERSONA_READER,
      repoPath: repo,
      displayName: 'Code Reviewer · my-app'
    })

    expect(await recordOfWork(reader)).toBeNull()
  })

  it('reports nothing before the worktree has been materialised', async () => {
    expect(await recordOfWork(writer())).toBeNull()
  })

  // The branch is read from the row and the files from git — never asked of the
  // model, whose answer would be unverifiable even when it arrived.
  it('names the branch and the files it changed', async () => {
    const contact = writer()
    await ensureWorktree(contact)
    writeFileSync(join(contact.worktreePath!, 'src/b.ts'), 'export const b = 2\n')
    run(['add', '-A'], contact.worktreePath!)
    run(['commit', '-m', 'buddy work'], contact.worktreePath!)

    const work = await recordOfWork(contact)

    expect(work?.branch).toBe(contact.branch)
    expect(work?.files).toEqual(['src/b.ts'])
    expect(work?.headSha).toMatch(/^[0-9a-f]{40}$/)
  })

  it('reports no files when the turn committed nothing', async () => {
    const contact = writer()
    await ensureWorktree(contact)

    expect((await recordOfWork(contact))?.files).toEqual([])
  })
})

describe('siblingBranchesFor', () => {
  it('is empty when nobody else is on the repo', () => {
    expect(siblingBranchesFor(writer())).toEqual([])
  })

  it('excludes the contact’s own branch', async () => {
    const contact = writer()
    await ensureWorktree(contact)

    expect(siblingBranchesFor(contact)).toEqual([])
  })

  // A Contact's branch is *planned* when it is created, so listing every row
  // would announce branches that do not exist in the repo at all.
  it('omits a branch that has only been planned', () => {
    const a = writer('Refactor Buddy · my-app')
    writer('Refactor Buddy 2 · my-app')

    expect(siblingBranchesFor(a)).toEqual([])
  })

  it('lists a colleague’s branch once its worktree exists', async () => {
    const a = writer('Refactor Buddy · my-app')
    const b = writer('Refactor Buddy 2 · my-app')
    await ensureWorktree(b)

    const siblings = siblingBranchesFor(a)

    expect(siblings).toHaveLength(1)
    expect(siblings[0].branch).toBe(b.branch)
    expect(siblings[0].contactName).toBe('Refactor Buddy 2 · my-app')
    expect(siblings[0].headSha).toBe(run(['rev-parse', b.branch!]))
  })

  it('ignores contacts bound to a different repo', async () => {
    const other = join(scratch, 'other-app')
    execFileSync('git', ['init', '-q', '-b', 'main', other])

    const a = writer('Refactor Buddy · my-app')
    const elsewhere = createContact({
      personaTemplateId: PERSONA_WRITER,
      repoPath: other,
      displayName: 'Refactor Buddy · other-app'
    })
    mkdirSync(elsewhere.worktreePath!, { recursive: true })
    writeFileSync(join(elsewhere.worktreePath!, '.git'), 'gitdir: nowhere\n')

    expect(siblingBranchesFor(a)).toEqual([])
  })
})
