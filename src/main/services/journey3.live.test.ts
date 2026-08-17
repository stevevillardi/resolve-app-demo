import { execFileSync } from 'child_process'
import { mkdtempSync, realpathSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { Octokit } from '@octokit/rest'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createTestDb } from '../db/test-db'
import { personaTemplates, routines } from '../db/schema'
import { adapterFor } from '../adapters'
import type { AppDatabase } from '../db/create'
import type { Contact, PersonaBackend } from '../../shared/domain'

/**
 * Blueprint §16 Journey 3, end to end and for real: a routine wakes up, does
 * bounded autonomous work, and opens a pull request rather than pushing.
 *
 * This is the check `docs/plan/08-routines-scheduler.md` left open, and the one
 * it deferred here — Phase 8 could fire the routine but had nowhere for the
 * work to go. It fires through `fireRoutine`, the same function cron calls, so
 * "the manual trigger is the same code path" stays a fact rather than a claim.
 *
 * **Skipped unless `LIVE_JOURNEY3=1`, and it spends real credits** — one turn
 * plus its summariser call. It also opens a real pull request, which it closes
 * again on the way out.
 *
 *   GITHUB_TOKEN=$(gh auth token) GITHUB_LIVE_REPO=owner/repo \
 *     LIVE_JOURNEY3=1 npx vitest run --project main src/main/services/journey3.live.test.ts
 *   …with JOURNEY3_BACKEND=codex for the other backend.
 *
 * What is deliberately *not* here: the "reads the repo/issues" half of the
 * journey. Nothing gives a persona a view of GitHub issues — the app passes
 * `settingSources: []` and no MCP servers, by design — and that is scoped as
 * docs/plan/14-agent-capability-surface.md rather than faked here.
 */

const LIVE = process.env.LIVE_JOURNEY3 === '1'
const TOKEN = process.env.GITHUB_TOKEN ?? ''
const SLUG = process.env.GITHUB_LIVE_REPO ?? ''
const [OWNER, REPO_NAME] = SLUG.split('/')
const BACKEND = (process.env.JOURNEY3_BACKEND ?? 'claude') as PersonaBackend
const PERSONA_MODEL =
  process.env.JOURNEY3_MODEL ?? (BACKEND === 'claude' ? 'claude-sonnet-5' : 'gpt-5.4-mini')

let db: AppDatabase
let scratch: string
let checkout: string
let userData: string
let contact: Contact
const opened: number[] = []

vi.mock('../db', () => ({ initDb: () => db }))
vi.mock('electron', () => ({ app: { getPath: () => userData } }))
vi.mock('./github-auth', () => ({ getGitHubToken: () => TOKEN }))
vi.mock('./agent-events', () => ({ emitAgentEvent: () => {}, emitRunsChanged: () => {}, emitUsageChanged: () => {}, emitMessagesChanged: () => {} }))
vi.mock('../notifications', () => ({ notifyTurnFinished: () => {}, notifyRoutineOutcome: () => {} }))
vi.mock('./adapter-host', () => ({
  adapterForBackend: (backend: PersonaBackend) => adapterFor(backend, {})
}))

const { fireRoutine } = await import('./scheduler')
const { createContact } = await import('./contacts')
const { getRoutine } = await import('./routines')
const { listUsageEvents } = await import('./usage-events')
const { cloneRepo } = await import('./git')

const PERSONA = 'persona-journey3'
const ROUTINE = 'routine-journey3'
const FILE = `src/journey3-${Date.now()}.ts`

beforeAll(async () => {
  if (!LIVE) return
  if (!TOKEN || !SLUG) throw new Error('Set GITHUB_TOKEN and GITHUB_LIVE_REPO to run this.')

  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'pr-journey3-')))
  userData = join(scratch, 'profile')
  checkout = await cloneRepo(`https://github.com/${SLUG}.git`, scratch, 'live', TOKEN)
  execFileSync('git', ['config', 'user.email', 'live-test@example.com'], { cwd: checkout })
  execFileSync('git', ['config', 'user.name', 'Switchboard live test'], { cwd: checkout })

  db = createTestDb()
  db.insert(personaTemplates)
    .values({
      id: PERSONA,
      name: 'Issue Fixer',
      avatarColor: '#c2410c',
      backend: BACKEND,
      systemPrompt: 'You make small, contained changes and always commit them.',
      skillIds: [],
      sandbox: 'workspace_write',
      // The governance axis the journey exists to demonstrate.
      githubScope: 'open_pr',
      model: PERSONA_MODEL
    })
    .run()

  contact = createContact({
    personaTemplateId: PERSONA,
    repoPath: checkout,
    displayName: 'Issue Fixer · live'
  })

  db.insert(routines)
    .values({
      id: ROUTINE,
      contactId: contact.id,
      schedule: '0 9 * * *',
      prompt:
        `Create the file ${FILE} exporting a single constant named journey3, ` +
        'then commit it with git. Keep it to that one file.',
      enabled: true,
      lastRunAt: null,
      lastRunSummary: null
    })
    .run()
}, 120_000)

afterAll(async () => {
  if (!LIVE || !scratch) return

  console.log(`\n=== routine ===\n${getRoutine(ROUTINE)?.lastRunSummary}`)
  let total = 0
  for (const event of listUsageEvents()) {
    total += event.costUsd ?? 0
    console.log(
      `${event.source.padEnd(8)} ${String(event.model).padEnd(28)} in ${event.inputTokens} out ${event.outputTokens} $${event.costUsd}`
    )
  }
  console.log(`TOTAL $${total.toFixed(4)}`)

  const octokit = new Octokit({ auth: TOKEN })
  for (const number of opened) {
    await octokit.rest.pulls
      .update({ owner: OWNER, repo: REPO_NAME, pull_number: number, state: 'closed' })
      .catch(() => {})
  }
  if (contact?.branch) {
    try {
      execFileSync(
        'git',
        [
          'push',
          `https://x-access-token:${TOKEN}@github.com/${SLUG}.git`,
          '--delete',
          contact.branch
        ],
        { cwd: checkout, stdio: 'ignore' }
      )
    } catch {
      // Never pushed, or already cleaned up.
    }
  }
  execFileSync('rm', ['-rf', scratch])
}, 120_000)

describe.skipIf(!LIVE)('Journey 3, live', () => {
  it('wakes up, does the work, and ends with a pull request rather than a push', async () => {
    const result = await fireRoutine(ROUTINE).completed

    expect(result.status).toBe('completed')

    const routine = getRoutine(ROUTINE)
    expect(routine?.lastRunAt).not.toBeNull()
    // The run history is where an unattended run reports itself, so the pull
    // request has to be legible from there and not only on github.com.
    expect(routine?.lastRunSummary).toMatch(/Opened PR #\d+/)

    const number = Number(/Opened PR #(\d+)/.exec(routine?.lastRunSummary ?? '')?.[1])
    opened.push(number)

    const octokit = new Octokit({ auth: TOKEN })
    const { data } = await octokit.rest.pulls.get({
      owner: OWNER,
      repo: REPO_NAME,
      pull_number: number
    })

    expect(data.state).toBe('open')
    expect(data.head.ref).toBe(contact.branch)

    // Bounded: the default branch was never written to directly.
    expect(data.base.ref).not.toBe(contact.branch)
    const { data: files } = await octokit.rest.pulls.listFiles({
      owner: OWNER,
      repo: REPO_NAME,
      pull_number: number
    })
    expect(files.map((file) => file.filename)).toContain(FILE)

    // And visible: the cost of an autonomous run is recorded, not silent.
    const usage = listUsageEvents()
    expect(usage.some((event) => event.source === 'routine')).toBe(true)
  }, 600_000)
})
