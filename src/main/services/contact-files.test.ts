import { execFileSync } from 'child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestDb } from '../db/test-db'
import { contacts, personaTemplates } from '../db/schema'
import type { AppDatabase } from '../db/create'

/**
 * Against real git and a real temp repo — the claims are about what ls-files
 * returns, and a faked runner would test our reading of its manpage.
 */

let db: AppDatabase
vi.mock('../db', () => ({ initDb: () => db }))

const { contactFiles, FILE_LIST_MAX } = await import('./contact-files')

const cleanups: string[] = []

function makeRepo(): string {
  const repo = mkdtempSync(join(tmpdir(), 'contact-files-'))
  cleanups.push(repo)
  execFileSync('git', ['init', '-q', '-b', 'main', repo])
  execFileSync('git', ['-C', repo, 'config', 'user.email', 'test@example.com'])
  execFileSync('git', ['-C', repo, 'config', 'user.name', 'Test'])
  return repo
}

function seedContact(id: string, repoPath: string, worktreePath: string | null = null): void {
  db.insert(contacts)
    .values({
      id,
      personaTemplateId: 'persona-1',
      repoPath,
      worktreePath,
      displayName: id,
      backendSessionId: null
    })
    .run()
}

beforeEach(() => {
  db = createTestDb()
  db.insert(personaTemplates)
    .values({
      id: 'persona-1',
      name: 'Reviewer',
      avatarColor: '#2a78d6',
      backend: 'claude',
      systemPrompt: 'Review.',
      skillIds: [],
      sandbox: 'read_only',
      githubScope: 'read_only'
    })
    .run()
})

afterEach(() => {
  while (cleanups.length > 0) rmSync(cleanups.pop()!, { recursive: true, force: true })
})

describe('contactFiles', () => {
  it('lists tracked and untracked files, and hides ignored ones', async () => {
    const repo = makeRepo()
    mkdirSync(join(repo, 'src'))
    writeFileSync(join(repo, 'src', 'auth.ts'), 'export {}\n')
    execFileSync('git', ['-C', repo, 'add', 'src/auth.ts'])
    execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'init'])
    writeFileSync(join(repo, 'notes.md'), 'untracked but real\n')
    writeFileSync(join(repo, '.gitignore'), 'dist/\n')
    mkdirSync(join(repo, 'dist'))
    writeFileSync(join(repo, 'dist', 'bundle.js'), '// noise\n')

    seedContact('contact-a', repo)
    const { files, truncated } = await contactFiles('contact-a')

    expect(files).toContain('src/auth.ts')
    expect(files).toContain('notes.md')
    expect(files).toContain('.gitignore')
    expect(files).not.toContain('dist/bundle.js')
    expect(truncated).toBe(false)
  })

  // ensureWorktree defers creation to the first turn, so a fresh isolated
  // contact legitimately points at a worktree that is not on disk yet. The
  // repo it will be branched from is the honest approximation.
  it('falls back to the repo while the worktree does not exist yet', async () => {
    const repo = makeRepo()
    writeFileSync(join(repo, 'real.ts'), 'export {}\n')

    seedContact('contact-iso', repo, join(repo, 'worktrees', 'not-yet'))
    const { files } = await contactFiles('contact-iso')

    expect(files).toContain('real.ts')
  })

  // Binding a plain directory is allowed everywhere else; the picker just has
  // nothing to offer there.
  it('degrades to an empty list for a non-repo directory', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'contact-files-plain-'))
    cleanups.push(dir)
    writeFileSync(join(dir, 'file.txt'), 'x\n')

    seedContact('contact-plain', dir)
    await expect(contactFiles('contact-plain')).resolves.toEqual({ files: [], truncated: false })
  })

  it('is empty for an unknown contact', async () => {
    await expect(contactFiles('nobody')).resolves.toEqual({ files: [], truncated: false })
  })

  it('caps the list and says so', async () => {
    const repo = makeRepo()
    const flood = join(repo, 'flood')
    mkdirSync(flood)
    for (let i = 0; i <= FILE_LIST_MAX; i += 1) writeFileSync(join(flood, `f${i}.txt`), '')

    seedContact('contact-big', repo)
    const { files, truncated } = await contactFiles('contact-big')

    expect(files).toHaveLength(FILE_LIST_MAX)
    expect(truncated).toBe(true)
  })
})
