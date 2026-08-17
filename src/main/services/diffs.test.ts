import { execFileSync } from 'child_process'
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestDb } from '../db/test-db'
import { messages, personaTemplates } from '../db/schema'
import type { AppDatabase } from '../db/create'
import type { Contact, TurnWork } from '../../shared/domain'

/**
 * The content behind the diff viewer, against real git — the claims are about
 * what git serves for each side of each change kind, and the budget behaviour
 * (withhold with a flag, never clip) that keeps the viewer honest.
 */

let db: AppDatabase
let scratch: string
let repo: string
let userData: string

vi.mock('../db', () => ({ initDb: () => db }))
vi.mock('electron', () => ({ app: { getPath: () => userData } }))

const { branchDiff, workDiff } = await import('./diffs')
const { createContact } = await import('./contacts')
const { ensureWorktree } = await import('./worktrees')

function run(args: string[], cwd = repo): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

function write(cwd: string, file: string, contents: string): void {
  mkdirSync(dirname(join(cwd, file)), { recursive: true })
  writeFileSync(join(cwd, file), contents)
}

function commitAllIn(cwd: string, message: string): string {
  run(['add', '-A'], cwd)
  run(['commit', '-q', '-m', message], cwd)
  return run(['rev-parse', 'HEAD'], cwd)
}

beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'pr-diffs-')))
  userData = join(scratch, 'profile')
  repo = join(scratch, 'my-app')

  execFileSync('git', ['init', '-q', '-b', 'main', repo])
  run(['config', 'user.email', 'test@example.com'])
  run(['config', 'user.name', 'Test'])
  write(repo, 'src/a.ts', 'line1\nline2\n')
  write(repo, 'src/old.ts', 'stable content that survives the rename intact\n')
  commitAllIn(repo, 'init')

  db = createTestDb()
  db.insert(personaTemplates)
    .values({
      id: 'persona-writer',
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

async function workingWriter(): Promise<Contact> {
  const contact = createContact({
    personaTemplateId: 'persona-writer',
    repoPath: repo,
    displayName: 'Refactor Buddy · my-app'
  })
  await ensureWorktree(contact)
  return contact
}

describe('branchDiff', () => {
  it('serves both sides of every change kind, renames included', async () => {
    const contact = await workingWriter()
    const wt = contact.worktreePath as string
    write(wt, 'src/a.ts', 'line1\nCHANGED\n')
    write(wt, 'src/added.ts', 'brand new\n')
    run(['mv', 'src/old.ts', 'src/new.ts'], wt)
    commitAllIn(wt, 'the work')

    const { baseSha, files } = await branchDiff(repo, contact.branch as string)

    expect(baseSha).toBe(run(['rev-parse', 'HEAD']))
    const byPath = Object.fromEntries(files.map((file) => [file.path, file]))
    expect(byPath['src/a.ts']).toMatchObject({
      status: 'modified',
      oldText: 'line1\nline2\n',
      newText: 'line1\nCHANGED\n'
    })
    expect(byPath['src/added.ts']).toMatchObject({
      status: 'added',
      oldText: null,
      newText: 'brand new\n'
    })
    expect(byPath['src/new.ts']).toMatchObject({ status: 'renamed', oldPath: 'src/old.ts' })
    expect(byPath['src/new.ts'].oldText).toContain('stable content')
  })

  it('flags a binary file and serves no text for it', async () => {
    const contact = await workingWriter()
    const wt = contact.worktreePath as string
    writeFileSync(join(wt, 'blob.bin'), Buffer.from([0, 1, 2, 255]))
    commitAllIn(wt, 'binary')

    const { files } = await branchDiff(repo, contact.branch as string)
    expect(files).toEqual([
      expect.objectContaining({ path: 'blob.bin', binary: true, oldText: null, newText: null })
    ])
  })

  it('refuses a branch name that is not one of ours', async () => {
    await workingWriter()
    await expect(branchDiff(repo, 'main')).rejects.toThrow(/no longer exists/)
    await expect(branchDiff(repo, '--help')).rejects.toThrow(/no longer exists/)
  })

  it('measures from the merge base even after main moves on', async () => {
    const contact = await workingWriter()
    const wt = contact.worktreePath as string
    write(wt, 'src/branchwork.ts', 'on the branch\n')
    commitAllIn(wt, 'branch work')
    write(repo, 'src/mainline.ts', 'main moved\n')
    commitAllIn(repo, 'main moves on')

    const { files } = await branchDiff(repo, contact.branch as string)
    expect(files.map((file) => file.path)).toEqual(['src/branchwork.ts'])
  })
})

describe('workDiff', () => {
  function stampReply(contactId: string, work: TurnWork): string {
    const id = `msg-${Math.random().toString(36).slice(2)}`
    db.insert(messages)
      .values({
        id,
        contactId,
        role: 'assistant',
        content: 'Done.',
        timestamp: new Date(),
        work
      })
      .run()
    return id
  }

  it('serves the committed half from the turn’s own heads', async () => {
    const contact = await workingWriter()
    const wt = contact.worktreePath as string
    const before = run(['rev-parse', 'HEAD'], wt)
    write(wt, 'src/a.ts', 'line1\nEDITED\n')
    const after = commitAllIn(wt, 'turn commit')

    const messageId = stampReply(contact.id, {
      branch: contact.branch,
      headBefore: before,
      headAfter: after,
      committed: ['src/a.ts'],
      dirty: []
    })

    const { files } = await workDiff(contact.id, messageId)
    expect(files).toEqual([
      expect.objectContaining({
        path: 'src/a.ts',
        status: 'modified',
        live: false,
        oldText: 'line1\nline2\n',
        newText: 'line1\nEDITED\n'
      })
    ])
  })

  it('serves the uncommitted half off the tree, marked live', async () => {
    const contact = await workingWriter()
    const wt = contact.worktreePath as string
    const head = run(['rev-parse', 'HEAD'], wt)
    write(wt, 'src/loose.ts', 'still uncommitted\n')

    const messageId = stampReply(contact.id, {
      branch: contact.branch,
      headBefore: head,
      headAfter: head,
      committed: [],
      dirty: ['src/loose.ts']
    })

    const { files } = await workDiff(contact.id, messageId)
    expect(files).toEqual([
      expect.objectContaining({
        path: 'src/loose.ts',
        status: 'added',
        live: true,
        oldText: null,
        newText: 'still uncommitted\n'
      })
    ])
  })

  it('is empty for a message with no work record', async () => {
    const contact = await workingWriter()
    const id = `msg-plain`
    db.insert(messages)
      .values({
        id,
        contactId: contact.id,
        role: 'assistant',
        content: 'ok',
        timestamp: new Date()
      })
      .run()

    expect(await workDiff(contact.id, id)).toEqual({ files: [], filesOmitted: 0 })
  })

  it("refuses another conversation's message id", async () => {
    const contact = await workingWriter()
    const other = createContact({
      personaTemplateId: 'persona-writer',
      repoPath: repo,
      displayName: 'Other · my-app'
    })
    const messageId = stampReply(other.id, {
      branch: null,
      headBefore: null,
      headAfter: null,
      committed: [],
      dirty: ['x']
    })

    await expect(workDiff(contact.id, messageId)).rejects.toThrow(/No such message/)
  })
})
