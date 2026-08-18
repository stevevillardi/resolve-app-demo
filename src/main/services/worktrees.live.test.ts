import { execFileSync } from 'child_process'
import { existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createTestDb } from '../db/test-db'
import { personaTemplates } from '../db/schema'
import { adapterFor } from '../adapters'
import type { AppDatabase } from '../db/create'
import type { AgentEvent } from '../../shared/agent'
import type { Contact, PersonaBackend } from '../../shared/domain'

/**
 * The three Phase 12 acceptance checks that no amount of unit testing can
 * settle, because they are about what a real backend does inside a real
 * worktree.
 *
 * **Skipped unless `LIVE_WORKTREES=1`.** It spends real credits, the same house
 * rule as journey2.live.test.ts. Run it per backend:
 *
 *   LIVE_WORKTREES=1 npx vitest run --project main src/main/services/worktrees.live.test.ts
 *   LIVE_WORKTREES=1 WORKTREE_BACKEND=codex npx vitest run --project main src/main/services/worktrees.live.test.ts
 *
 * Running it per backend is the point of the first check rather than an
 * afterthought. Claude and Codex reach the sandbox by different routes —
 * `sandbox.filesystem.allowWrite` versus `--add-dir` — so one passing says
 * nothing whatever about the other.
 *
 * What makes this necessary: a linked worktree's `.git` is a *file* pointing
 * into the main repo, so a commit writes outside the working directory. Every
 * unit test here mocks the adapter, and a mocked adapter never runs `git add`.
 * If the write grant is wrong, everything stays green and every real turn fails.
 */

const LIVE = process.env.LIVE_WORKTREES === '1'
const BACKEND = (process.env.WORKTREE_BACKEND ?? 'claude') as PersonaBackend

/**
 * Mid-tier on purpose: this verifies plumbing, not brilliance. Overridable with
 * `WORKTREE_MODEL` so an intermittent failure can be chased on a cheap model —
 * sandbox behaviour is not model-dependent, and reproducing it ten times on
 * sonnet costs ten times as much as reproducing it on haiku.
 */
const PERSONA_MODEL =
  process.env.WORKTREE_MODEL ?? (BACKEND === 'claude' ? 'claude-sonnet-5' : 'gpt-5.4-mini')

let db: AppDatabase
let repoPath: string
let userData: string

vi.mock('../db', () => ({ initDb: () => db }))
vi.mock('electron', () => ({ app: { getPath: () => userData } }))

const finished = new Map<string, () => void>()
const events: { runId: string; event: AgentEvent }[] = []

vi.mock('./agent-events', () => ({
  emitAgentEvent: (runId: string, event: AgentEvent) => {
    events.push({ runId, event })
    if (event.type === 'done') finished.get(runId)?.()
  },
  emitRunsChanged: () => {},
  emitUsageChanged: () => {},
  emitMessagesChanged: () => {}
}))
vi.mock('../notifications', () => ({
  notifyTurnFinished: () => {},
  notifyRoutineOutcome: () => {}
}))

// Real adapters with no injected config, exactly as scripts/probe-adapters.ts
// runs them: outside Electron both CLIs use the login already on this machine.
vi.mock('./adapter-host', () => ({
  adapterForBackend: (backend: PersonaBackend) => adapterFor(backend, {})
}))

const { listMessages, sendMessage } = await import('./messaging')
const { createContact } = await import('./contacts')
const { groupForRepo, listGroupMessages } = await import('./group-messages')
const { listUsageEvents } = await import('./usage-events')

function git(args: string[], cwd = repoPath): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

function turnDone(runId: string): Promise<void> {
  return new Promise((resolve) => finished.set(runId, resolve))
}

/** Sends and waits for the turn to actually finish — these are network calls. */
async function ask(contactId: string, content: string): Promise<string> {
  const { runId } = sendMessage(contactId, content)
  await turnDone(runId)
  const replies = listMessages(contactId).filter((message) => message.role === 'assistant')
  return replies.at(-1)?.content ?? ''
}

function seedPersona(id: string, name: string, sandbox: 'read_only' | 'workspace_write'): void {
  db.insert(personaTemplates)
    .values({
      id,
      name,
      avatarColor: '#2a78d6',
      backend: BACKEND,
      systemPrompt:
        sandbox === 'workspace_write'
          ? 'You are a coding agent. Make the change you are asked for, then commit it with git. Keep replies to one sentence.'
          : 'You review code. Answer briefly and never modify anything.',
      skillIds: [],
      sandbox,
      githubScope: 'read_only',
      model: PERSONA_MODEL
    })
    .run()
}

beforeAll(() => {
  if (!LIVE) return

  userData = realpathSync(mkdtempSync(join(tmpdir(), 'wt-live-profile-')))
  repoPath = realpathSync(mkdtempSync(join(tmpdir(), 'wt-live-repo-')))

  writeFileSync(join(repoPath, 'util.ts'), 'export const VERSION = 1\n')
  git(['init', '-q', '-b', 'main'])
  git(['config', 'user.email', 'live@example.com'])
  git(['config', 'user.name', 'Live Test'])
  git(['add', '.'])
  git(['commit', '-qm', 'init'])

  db = createTestDb()
  seedPersona('persona-writer', 'Refactor Buddy', 'workspace_write')
  seedPersona('persona-reader', 'Code Reviewer', 'read_only')
})

afterAll(() => {
  if (!LIVE) return
  console.log(`\n=== ${BACKEND} / ${PERSONA_MODEL} ===`)
  console.log('worktrees:\n' + git(['worktree', 'list']))
  console.log('branches: ' + git(['branch', '--format=%(refname:short)']).replace(/\n/g, ' '))
  const group = groupForRepo(repoPath)
  if (group) {
    console.log('\n=== group thread ===')
    for (const message of listGroupMessages(group.id)) {
      console.log(
        `[${message.type}${message.branch ? ` on ${message.branch}` : ''}] ${message.content.slice(0, 160)}`
      )
    }
  }
  console.log('\n=== usage ===')
  let total = 0
  for (const event of listUsageEvents()) {
    total += event.costUsd ?? 0
    console.log(
      `${event.source.padEnd(8)} ${String(event.model).padEnd(28)} in ${event.inputTokens} out ${event.outputTokens} $${event.costUsd}`
    )
  }
  console.log(`TOTAL $${total.toFixed(4)}`)
})

function bindWriter(displayName: string): Contact {
  return createContact({ personaTemplateId: 'persona-writer', repoPath, displayName })
}

describe.skipIf(!LIVE)(`worktree isolation, live on ${BACKEND}`, () => {
  let writer: Contact

  /**
   * Gate 1 — the sandbox grant, end to end.
   *
   * This is the check the whole phase rests on. The model has to run `git add`
   * and `git commit` from inside a worktree, which writes to
   * `<repo>/.git/worktrees/<name>` — outside its own working directory. Without
   * `writablePaths` reaching the backend it fails on `index.lock`, which is
   * exactly what happens with the grant removed.
   */
  it('a worktree writer can actually commit', { timeout: 300_000 }, async () => {
    writer = bindWriter('Refactor Buddy · live')
    expect(writer.isolation).toBe('worktree')

    const reply = await ask(
      writer.id,
      'Add `export const GREETING = "hello"` to util.ts, then commit that change with git. Reply with just the commit subject.'
    )
    console.log(`[gate 1 reply] ${reply.slice(0, 300)}`)

    // The commit is the assertion. A turn that merely *said* it committed
    // leaves the branch where it started.
    const branchHead = git(['rev-parse', writer.branch as string])
    const mainHead = git(['rev-parse', 'main'])
    expect(branchHead, 'the branch should have moved past main').not.toBe(mainHead)

    // And the change is on the branch, readable without checking it out.
    expect(git(['show', `${writer.branch}:util.ts`])).toContain('GREETING')

    // The user's own checkout is untouched — that is the isolation half.
    expect(readFileSync(join(repoPath, 'util.ts'), 'utf8')).not.toContain('GREETING')
    expect(git(['status', '--porcelain'])).toBe('')
  })

  /**
   * Gate 2 — two writers at once, which is the contention this phase exists to
   * end. Before it, the second would have been refused by the run lock.
   */
  it(
    'two writing contacts run at the same time and both complete',
    { timeout: 300_000 },
    async () => {
      const a = bindWriter('Writer A · live')
      const b = bindWriter('Writer B · live')

      // Started without awaiting the first, so they genuinely overlap. Under the
      // old lock this second call threw synchronously.
      const runA = sendMessage(
        a.id,
        'Create a file called a.ts containing `export const A = 1`, then commit it. Reply with one word.'
      )
      const runB = sendMessage(
        b.id,
        'Create a file called b.ts containing `export const B = 2`, then commit it. Reply with one word.'
      )

      await Promise.all([turnDone(runA.runId), turnDone(runB.runId)])

      // Printed unconditionally, before anything can abort the test. A run of
      // this on sonnet once failed with a single permission denial on one
      // writer and has not reproduced in seven attempts since; if it happens
      // again the message is the only evidence there will be, and an assertion
      // that fired first would have thrown it away.
      for (const [label, runId] of [
        ['A', runA.runId],
        ['B', runB.runId]
      ] as const) {
        const errors = events
          .filter((entry) => entry.runId === runId && entry.event.type === 'error')
          .map((entry) => JSON.stringify(entry.event))
        console.log(
          `[gate 2 writer ${label}] errors: ${errors.length ? errors.join(' | ') : 'none'}`
        )
      }

      for (const [contact, runId, own, other] of [
        [a, runA.runId, 'a.ts', 'b.ts'],
        [b, runB.runId, 'b.ts', 'a.ts']
      ] as const) {
        // The filesystem first: it is the acceptance check, and it says more
        // than the error list does — a denied write shows up here as a missing
        // file, which distinguishes "the turn was blocked" from "the turn
        // complained but did the work anyway".
        expect(
          existsSync(join(contact.worktreePath as string, own)),
          `${own} should exist in ${contact.displayName}'s own tree`
        ).toBe(true)
        // Neither can see the other's work on disk — §6's degradation, made real.
        expect(
          existsSync(join(contact.worktreePath as string, other)),
          `${other} must not be visible to ${contact.displayName}`
        ).toBe(false)

        const errors = events
          .filter((entry) => entry.runId === runId && entry.event.type === 'error')
          .map((entry) => entry.event)
        expect(errors, `${contact.displayName} should not have errored`).toEqual([])
      }

      // Nor can the user.
      expect(existsSync(join(repoPath, 'a.ts'))).toBe(false)
      expect(existsSync(join(repoPath, 'b.ts'))).toBe(false)
    }
  )

  /**
   * Gate 3 — the claim that saves blueprint §6. A reader in the main tree
   * cannot see the writer's changes on disk at all, but the object store is
   * shared, so `git show` reaches them with nothing merged and no elevated
   * permission. If the read-only allowlist refused these commands the persona
   * would have nothing to answer with.
   */
  it('a read_only contact reads an unmerged sibling branch', { timeout: 300_000 }, async () => {
    const reader = createContact({
      personaTemplateId: 'persona-reader',
      repoPath,
      displayName: 'Code Reviewer · live'
    })
    expect(reader.isolation, 'a reader stays in the main tree').toBe('shared')
    expect(reader.worktreePath).toBeNull()

    const reply = await ask(
      reader.id,
      `The branch ${writer.branch} has work that is not in this checkout. Run \`git show ${writer.branch}:util.ts\` and tell me the exact name of the new exported constant it adds. Answer with the identifier only.`
    )
    console.log(`[gate 3 reply] ${reply.slice(0, 300)}`)

    // It could only know this by reading the sibling branch: the identifier
    // exists nowhere in its own working directory.
    expect(reply).toContain('GREETING')
    expect(readFileSync(join(repoPath, 'util.ts'), 'utf8')).not.toContain('GREETING')
  })
})
