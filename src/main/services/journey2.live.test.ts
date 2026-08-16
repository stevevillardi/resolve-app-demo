import { execFileSync } from 'child_process'
import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createTestDb } from '../db/test-db'
import { contacts, groups, personaTemplates } from '../db/schema'
import { adapterFor } from '../adapters'
import type { AppDatabase } from '../db/create'
import type { AgentEvent } from '../../shared/agent'
import type { PersonaBackend } from '../../shared/domain'

/**
 * Blueprint §16 Journey 2, against real backends.
 *
 * **Skipped unless `LIVE_JOURNEY2=1`.** It spends real credits, so it is not
 * part of `npm test` — same house rule as e2e/messaging.spec.ts. Run it with:
 *
 *   LIVE_JOURNEY2=1 npx vitest run --project main src/main/services/journey2.live.test.ts
 *
 * It exists because Journey 2 is the one thing in Phase 7 that cannot be
 * faked. Every mechanism here has unit tests against a scripted adapter, and
 * those tests prove the wiring is consistent with itself — they cannot prove
 * that a real model, handed a colleague's summary in its system prompt,
 * actually uses it. That is the question the phase was built to answer.
 *
 * The database, the group, and the repo are all real; only `electron` is
 * stubbed, because nothing here needs a window.
 */

const LIVE = process.env.LIVE_JOURNEY2 === '1'

/**
 * Personas run on a mid-tier model rather than the backend default. The
 * default is opus, and a fresh session writes ~22k tokens of prompt cache
 * before it says anything — about $0.23 a turn, which is a lot to pay for a
 * verification run. Summaries still use whatever SUMMARY_MODELS says, since
 * that choice is part of what is being verified.
 */
const PERSONA_MODEL = 'claude-sonnet-5'
const BACKEND: PersonaBackend = 'claude'

let db: AppDatabase
let repoPath: string

vi.mock('../db', () => ({ initDb: () => db }))

/** Resolved when the run for a given runId reports `done`. */
const finished = new Map<string, () => void>()
const events: { runId: string; event: AgentEvent }[] = []

vi.mock('./agent-events', () => ({
  emitAgentEvent: (runId: string, event: AgentEvent) => {
    events.push({ runId, event })
    if (event.type === 'done') finished.get(runId)?.()
  },
  emitRunsChanged: () => {},
  emitUsageChanged: () => {}
}))

// The real adapters, with no injected config: outside Electron the Codex SDK
// resolves its own binary and both CLIs use the login already on this machine.
// Exactly how scripts/probe-adapters.ts runs them.
vi.mock('./adapter-host', () => ({
  adapterForBackend: (backend: PersonaBackend) => adapterFor(backend, {})
}))

const { listMessages, mentionInGroup, sendMessage } = await import('./messaging')
const { listGroupMessages } = await import('./group-messages')
const { listUsageEvents } = await import('./usage-events')

const GROUP = 'group-live'

/** Blocks until the turn actually completes — these are real network calls. */
function turnDone(runId: string): Promise<void> {
  return new Promise((resolve) => finished.set(runId, resolve))
}

/**
 * Compaction is fired un-awaited from finish(), on purpose, so there is no
 * handle to wait on. Polling the Group is the honest way to wait for it.
 */
async function waitForSummaries(count: number, timeoutMs = 120_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const summaries = listGroupMessages(GROUP).filter((m) => m.type === 'system_summary')
    if (summaries.length >= count) return
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  throw new Error(`only ${listGroupMessages(GROUP).length} group messages after ${timeoutMs}ms`)
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
          ? 'You refactor code. Make the change you are asked for, then state the rationale in one sentence.'
          : 'You review code. Answer briefly and never modify anything.',
      skillIds: [],
      sandbox,
      githubScope: 'read_only',
      model: PERSONA_MODEL
    })
    .run()
}

function seedContact(id: string, personaId: string, name: string): void {
  db.insert(contacts)
    .values({
      id,
      personaTemplateId: personaId,
      repoPath,
      displayName: name,
      backendSessionId: null
    })
    .run()
}

beforeAll(() => {
  if (!LIVE) return

  // A throwaway git repo: Codex refuses to start outside a working tree, and a
  // writer persona has to have something it can actually change.
  repoPath = mkdtempSync(join(tmpdir(), 'journey2-'))
  writeFileSync(
    join(repoPath, 'auth.ts'),
    [
      "import { readFileSync } from 'fs'",
      '',
      'export function currentToken(): string {',
      '  // Re-reads the file on every call.',
      "  return readFileSync('/tmp/token', 'utf8').trim()",
      '}',
      ''
    ].join('\n')
  )
  execFileSync('git', ['init', '-q'], { cwd: repoPath })
  execFileSync('git', ['add', '.'], { cwd: repoPath })
  execFileSync('git', ['-c', 'user.email=a@b.c', '-c', 'user.name=t', 'commit', '-qm', 'init'], {
    cwd: repoPath
  })

  db = createTestDb()
  db.insert(groups).values({ id: GROUP, repoPath }).run()

  seedPersona('persona-writer', 'Refactor Buddy', 'workspace_write')
  seedPersona('persona-reader', 'Code Reviewer', 'read_only')
  seedPersona('persona-third', 'Test Writer', 'read_only')
  seedContact('contact-writer', 'persona-writer', 'Refactor Buddy')
  seedContact('contact-reader', 'persona-reader', 'Code Reviewer')
  seedContact('contact-third', 'persona-third', 'Test Writer')
})

afterAll(() => {
  if (!LIVE) return
  console.log('\n=== group thread ===')
  for (const message of listGroupMessages(GROUP)) {
    console.log(
      `[${message.type}${message.category ? '/' + message.category : ''}${message.durable ? ' durable' : ''}] ${message.content.slice(0, 200)}`
    )
  }
  console.log('\n=== usage ===')
  for (const event of listUsageEvents()) {
    console.log(
      `${event.source.padEnd(8)} ${String(event.model).padEnd(28)} in ${event.inputTokens} out ${event.outputTokens} $${event.costUsd}`
    )
  }
})

describe.skipIf(!LIVE)('Journey 2, live', () => {
  it('posts a durable summary when a writer makes a change', async () => {
    const { runId } = sendMessage(
      'contact-writer',
      'auth.ts re-reads the token file on every call. Cache it in a module-level variable and make the change.'
    )
    await turnDone(runId)
    await waitForSummaries(1)

    const [summary] = listGroupMessages(GROUP).filter((m) => m.type === 'system_summary')
    console.log(`\nsummary: [${summary.category}] ${summary.content}`)

    expect(summary.contactId).toBe('contact-writer')
    // §6's rule: a decision or a tradeoff is durable, routine work is not. A
    // real code change should not classify as routine.
    expect(summary.durable).toBe(true)
    expect(['decision', 'tradeoff']).toContain(summary.category)
  }, 300_000)

  it('lets a second persona reference that work without being told', async () => {
    // The whole point of §5's injection, and the answer to "is this actually
    // multi-agent or just three windows". Nothing in this prompt mentions
    // caching, the token, or Refactor Buddy.
    const { runId } = sendMessage(
      'contact-reader',
      'What has anyone changed in this repo recently? Answer from what you already know, without reading any files.'
    )
    await turnDone(runId)

    const reply = listMessages('contact-reader').at(-1)?.content ?? ''
    console.log(`\nreviewer reply: ${reply}`)

    expect(reply.toLowerCase()).toMatch(/cach|token/)
  }, 300_000)

  it('routes an @mention into both threads with one copy of the text', async () => {
    const { runId, groupMessage } = mentionInGroup(
      GROUP,
      'contact-third',
      '@Test Writer what single test would you write for the change that was just made?'
    )
    expect(groupMessage.type).toBe('user_mention')
    await turnDone(runId)

    const inThread = listMessages('contact-third').at(-1)
    const inGroup = listGroupMessages(GROUP)
      .filter((m) => m.type === 'agent_reply')
      .at(-1)

    // One exchange rendered two ways, not two exchanges — the identical text
    // is the claim, and a divergent copy is the failure it rules out.
    expect(inGroup?.content).toBe(inThread?.content)
    expect(inGroup?.contactId).toBe('contact-third')
  }, 300_000)

  it('attributes the spend to the right source and the right model', async () => {
    const events = listUsageEvents()
    const sources = new Set(events.map((event) => event.source))

    expect(sources).toContain('message')
    expect(sources).toContain('mention')
    expect(sources).toContain('summary')

    // Every row names the model that served it — and a summary runs on the
    // cheap model rather than whatever the persona was configured with.
    for (const event of events) expect(event.model).toBeTruthy()
    for (const event of events.filter((e) => e.source === 'summary')) {
      expect(event.model).not.toBe(PERSONA_MODEL)
    }
  })
})
