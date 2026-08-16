import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestDb } from '../db/test-db'
import { contacts, personaTemplates, skills, usageEvents } from '../db/schema'
import type { AppDatabase } from '../db/create'
import type { AgentEvent, AgentUsage } from '../../shared/agent'
import type { SandboxLevel } from '../../shared/domain'

/**
 * The turn loop, with the SDKs replaced by a scripted event stream.
 *
 * What is deliberately *not* faked is the database: these run against a real
 * in-memory SQLite with the checked-in migrations applied, because the point of
 * most of these assertions is what ends up on disk.
 */

let db: AppDatabase

/** Events the fake adapter will yield, per run. */
let script: AgentEvent[] = []
/** Set to make the adapter throw instead of yielding — the escaped-error path. */
let throwOnRun: Error | null = null
/** Blocks the stream so a turn can be observed mid-flight. */
let gate: { promise: Promise<void>; open: () => void } | null = null

let created: { resumedFrom: string | null; model?: string; skillNames: string[] }[] = []
let sessionIdToReport: string | null = 'session-abc'
let lastSignal: AbortSignal | null = null

const emitted: { runId: string; event: AgentEvent }[] = []
let runsChangedCount = 0

vi.mock('../db', () => ({ initDb: () => db }))

vi.mock('./agent-events', () => ({
  emitAgentEvent: (runId: string, event: AgentEvent) => emitted.push({ runId, event }),
  emitRunsChanged: () => {
    runsChangedCount += 1
  }
}))

vi.mock('./adapter-host', () => ({
  adapterForBackend: () => fakeAdapter
}))

const fakeAdapter = {
  backend: 'claude' as const,
  capabilities: {
    streamsTextDeltas: true,
    streamsToolProgress: true,
    costSource: 'sdk' as const,
    sandboxEnforcement: 'os' as const
  },
  createSession(spec: { model?: string; skills: { name: string }[] }) {
    created.push({
      resumedFrom: null,
      ...(spec.model !== undefined && { model: spec.model }),
      skillNames: spec.skills.map((skill) => skill.name)
    })
    return { backend: 'claude' as const, spec, sessionId: null as string | null }
  },
  resume(spec: { model?: string; skills: { name: string }[] }, sessionId: string) {
    created.push({
      resumedFrom: sessionId,
      ...(spec.model !== undefined && { model: spec.model }),
      skillNames: spec.skills.map((skill) => skill.name)
    })
    return { backend: 'claude' as const, spec, sessionId: sessionId as string | null }
  },
  async *run(
    session: { sessionId: string | null },
    _prompt: string,
    signal?: AbortSignal
  ): AsyncIterable<AgentEvent> {
    lastSignal = signal ?? null
    if (throwOnRun) throw throwOnRun

    for (const event of script) {
      if (gate) await gate.promise
      // Mirrors the real adapters: the resume key is filled in mid-stream, not
      // known up front.
      if (event.type === 'session_started') session.sessionId = sessionIdToReport
      yield event
    }
  }
}

const { cancelRun, listActiveRuns, listMessages, messagePreviews, sendMessage } =
  await import('./messaging')
const { resetRunLocks } = await import('./run-lock')

const USAGE: AgentUsage = {
  inputTokens: 120,
  outputTokens: 45,
  cachedInputTokens: 8960,
  costUsd: 0.0031,
  costSource: 'sdk',
  model: 'claude-haiku-4-5-20251001'
}

const REPO = '/Users/dev/my-app'

function seedPersona(id: string, sandbox: SandboxLevel, model: string | null = null): void {
  db.insert(personaTemplates)
    .values({
      id,
      name: `Persona ${id}`,
      avatarColor: '#2a78d6',
      backend: 'claude',
      systemPrompt: 'Review carefully.',
      skillIds: ['skill-1'],
      sandbox,
      githubScope: 'read_only',
      model
    })
    .run()
}

function seedContact(id: string, personaId: string, repoPath = REPO): void {
  db.insert(contacts)
    .values({
      id,
      personaTemplateId: personaId,
      repoPath,
      displayName: `Contact ${id}`,
      backendSessionId: null
    })
    .run()
}

/** Lets the microtask queue drain so the un-awaited runTurn() can finish. */
async function settle(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await Promise.resolve()
}

beforeEach(() => {
  db = createTestDb()
  resetRunLocks()
  script = [
    { type: 'session_started', sessionId: 'session-abc' },
    { type: 'text_message', text: 'Looks good.' },
    { type: 'done', finalText: 'Looks good.', usage: USAGE }
  ]
  throwOnRun = null
  gate = null
  created = []
  sessionIdToReport = 'session-abc'
  lastSignal = null
  emitted.length = 0
  runsChangedCount = 0

  db.insert(skills)
    .values({ id: 'skill-1', name: 'Review checklist', description: '', content: 'Be thorough.' })
    .run()
  seedPersona('persona-read', 'read_only')
  seedContact('contact-a', 'persona-read')
})

describe('sendMessage', () => {
  it('persists the user message before the turn runs', () => {
    const { userMessage } = sendMessage('contact-a', 'review auth.ts')

    expect(userMessage.role).toBe('user')
    expect(listMessages('contact-a')[0].content).toBe('review auth.ts')
  })

  it('persists the assistant reply from done.finalText', async () => {
    sendMessage('contact-a', 'review auth.ts')
    await settle()

    const thread = listMessages('contact-a')
    expect(thread.map((message) => message.role)).toEqual(['user', 'assistant'])
    expect(thread[1].content).toBe('Looks good.')
  })

  it('records usage exactly as the adapter reported it', async () => {
    sendMessage('contact-a', 'review auth.ts')
    await settle()

    const [event] = db.select().from(usageEvents).all()
    expect(event.inputTokens).toBe(120)
    expect(event.outputTokens).toBe(45)
    expect(event.costUsd).toBe(0.0031)
    expect(event.model).toBe('claude-haiku-4-5-20251001')
    expect(event.source).toBe('message')
  })

  // Null means "no published price for this model". Rendering it as 0 would
  // under-report spend, so it has to survive the round trip as null.
  it('keeps an unknown cost null rather than zero', async () => {
    script = [{ type: 'done', finalText: 'ok', usage: { ...USAGE, costUsd: null } }]
    sendMessage('contact-a', 'go')
    await settle()

    expect(db.select().from(usageEvents).all()[0].costUsd).toBeNull()
  })

  it('resolves the persona skills into the session', () => {
    sendMessage('contact-a', 'go')
    expect(created[0].skillNames).toEqual(['Review checklist'])
  })

  it('passes the persona model through, and omits it when null', () => {
    sendMessage('contact-a', 'go')
    expect(created[0].model).toBeUndefined()

    resetRunLocks()
    seedPersona('persona-model', 'read_only', 'claude-opus-5')
    seedContact('contact-model', 'persona-model', '/other/repo')
    sendMessage('contact-model', 'go')

    expect(created[1].model).toBe('claude-opus-5')
  })

  it('rejects an unknown contact', () => {
    expect(() => sendMessage('nope', 'go')).toThrow(/No such contact/)
  })
})

describe('session resumption', () => {
  it('creates a session on the first turn and stores the resume key', async () => {
    sendMessage('contact-a', 'go')
    await settle()

    expect(created[0].resumedFrom).toBeNull()
    expect(db.select().from(contacts).all()[0].backendSessionId).toBe('session-abc')
  })

  it('resumes on the next turn', async () => {
    sendMessage('contact-a', 'first')
    await settle()
    sendMessage('contact-a', 'second')
    await settle()

    expect(created[1].resumedFrom).toBe('session-abc')
  })

  it('leaves the contact alone when the backend reports no session', async () => {
    sessionIdToReport = null
    script = [{ type: 'done', finalText: 'ok', usage: null }]

    sendMessage('contact-a', 'go')
    await settle()

    expect(db.select().from(contacts).all()[0].backendSessionId).toBeNull()
  })
})

describe('streaming', () => {
  it('forwards every event except done, then emits done last', async () => {
    sendMessage('contact-a', 'go')
    await settle()

    expect(emitted.map((entry) => entry.event.type)).toEqual([
      'session_started',
      'text_message',
      'done'
    ])
  })

  // The renderer refetches when it sees `done`. If that arrived before the rows
  // were written it would refetch a thread missing the reply it just watched.
  it('writes the reply before done reaches the renderer', async () => {
    let threadAtDone: number | null = null
    emitted.length = 0

    sendMessage('contact-a', 'go')
    await settle()

    for (const entry of emitted) {
      if (entry.event.type === 'done') threadAtDone = listMessages('contact-a').length
    }
    expect(threadAtDone).toBe(2)
  })

  it('tags every event with the run it belongs to', async () => {
    const { runId } = sendMessage('contact-a', 'go')
    await settle()

    expect(emitted.every((entry) => entry.runId === runId)).toBe(true)
  })

  // The composer enables and disables off `runs.list`, so a missed
  // notification at either end leaves the UI lying about whether it can send.
  it('announces the run set at both ends of a turn', async () => {
    runsChangedCount = 0
    sendMessage('contact-a', 'go')
    expect(runsChangedCount).toBe(1)

    await settle()
    expect(runsChangedCount).toBe(2)
  })

  it('announces the run set even when the turn fails', async () => {
    throwOnRun = new Error('boom')
    runsChangedCount = 0

    sendMessage('contact-a', 'go')
    await settle()

    expect(runsChangedCount).toBe(2)
  })
})

describe('failure', () => {
  // Both adapters guarantee a `done`, so this is the path for a failure that
  // escapes that guarantee. The thread still has to reach a terminal state.
  it('turns an escaped exception into an error event and a done', async () => {
    throwOnRun = new Error('spawn ENOENT')
    sendMessage('contact-a', 'go')
    await settle()

    expect(emitted.map((entry) => entry.event.type)).toEqual(['error', 'done'])
    expect(emitted[0].event).toMatchObject({ kind: 'unknown', message: 'spawn ENOENT' })
  })

  it('releases the lock after a failure', async () => {
    throwOnRun = new Error('boom')
    sendMessage('contact-a', 'go')
    await settle()

    expect(listActiveRuns()).toEqual([])
    expect(() => sendMessage('contact-a', 'again')).not.toThrow()
  })

  it('writes no assistant row when the turn produced no text', async () => {
    throwOnRun = new Error('boom')
    sendMessage('contact-a', 'go')
    await settle()

    expect(listMessages('contact-a').map((message) => message.role)).toEqual(['user'])
  })

  it('still records usage from a turn that errored but reported it', async () => {
    script = [
      { type: 'error', kind: 'rate_limit', message: 'slow down' },
      { type: 'done', finalText: '', usage: USAGE }
    ]
    sendMessage('contact-a', 'go')
    await settle()

    expect(db.select().from(usageEvents).all()).toHaveLength(1)
  })
})

describe('the concurrency lock', () => {
  it('lets two readers on one repo run together', () => {
    seedPersona('persona-read-2', 'read_only')
    seedContact('contact-b', 'persona-read-2')

    gate = holdOpen()
    expect(() => sendMessage('contact-a', 'go')).not.toThrow()
    expect(() => sendMessage('contact-b', 'go')).not.toThrow()
  })

  // Journey 2's pair. Under blueprint §15D's literal repo-wide lock this fails.
  it('lets a reader run while a writer holds the repo', () => {
    seedPersona('persona-write', 'workspace_write')
    seedContact('contact-w', 'persona-write')

    gate = holdOpen()
    sendMessage('contact-a', 'go')
    expect(() => sendMessage('contact-w', 'go')).toThrow()
  })

  it('refuses a second writer, naming who holds it', () => {
    seedPersona('persona-write', 'workspace_write')
    seedContact('contact-w1', 'persona-write')
    seedContact('contact-w2', 'persona-write')

    gate = holdOpen()
    sendMessage('contact-w1', 'go')

    expect(() => sendMessage('contact-w2', 'go')).toThrow(/Contact contact-w1 is already working/)
  })

  // A refused send must leave nothing behind — a persisted question nothing
  // will answer reads as a lost message rather than as a refusal.
  it('writes no message when a send is refused', () => {
    seedPersona('persona-write', 'workspace_write')
    seedContact('contact-w1', 'persona-write')
    seedContact('contact-w2', 'persona-write')

    gate = holdOpen()
    sendMessage('contact-w1', 'go')
    expect(() => sendMessage('contact-w2', 'blocked')).toThrow()

    expect(listMessages('contact-w2')).toEqual([])
  })

  it('does not let one repo block another', () => {
    seedPersona('persona-write', 'workspace_write')
    seedContact('contact-w1', 'persona-write', '/repo/one')
    seedContact('contact-w2', 'persona-write', '/repo/two')

    gate = holdOpen()
    expect(() => sendMessage('contact-w1', 'go')).not.toThrow()
    expect(() => sendMessage('contact-w2', 'go')).not.toThrow()
  })

  it('releases the lock when the turn finishes', async () => {
    sendMessage('contact-a', 'go')
    await settle()
    expect(listActiveRuns()).toEqual([])
  })
})

describe('cancelRun', () => {
  it('passes an abort signal to the adapter', () => {
    sendMessage('contact-a', 'go')
    expect(lastSignal).not.toBeNull()
  })

  it('aborts the signal', () => {
    gate = holdOpen()
    const { runId } = sendMessage('contact-a', 'go')

    expect(cancelRun(runId)).toBe(true)
    expect(lastSignal?.aborted).toBe(true)
  })

  it('reports an unknown run rather than throwing', () => {
    expect(cancelRun('not-a-run')).toBe(false)
  })

  // A stopped review is still worth keeping — the alternative is a blank bubble
  // where the user watched text appear.
  it('keeps text streamed before the stop', async () => {
    script = [
      { type: 'session_started', sessionId: 'session-abc' },
      { type: 'text_message', text: 'Half a rev' }
    ]
    sendMessage('contact-a', 'go')
    await settle()

    const thread = listMessages('contact-a')
    expect(thread[1].content).toBe('Half a rev')
  })
})

describe('messagePreviews', () => {
  it('returns the latest message per contact', async () => {
    seedPersona('persona-read-2', 'read_only')
    seedContact('contact-b', 'persona-read-2', '/repo/two')

    sendMessage('contact-a', 'first')
    await settle()
    sendMessage('contact-a', 'second')
    await settle()
    sendMessage('contact-b', 'only')
    await settle()

    const previews = messagePreviews()
    expect(previews).toHaveLength(2)
    expect(previews.find((message) => message.contactId === 'contact-a')?.content).toBe(
      'Looks good.'
    )
  })

  it('is empty before anything is sent', () => {
    expect(messagePreviews()).toEqual([])
  })
})

describe('listActiveRuns', () => {
  it('reports an in-flight run', () => {
    gate = holdOpen()
    const { runId } = sendMessage('contact-a', 'go')

    const runs = listActiveRuns()
    expect(runs).toHaveLength(1)
    expect(runs[0]).toMatchObject({ runId, contactId: 'contact-a', mode: 'shared' })
  })
})

function holdOpen(): { promise: Promise<void>; open: () => void } {
  let open = (): void => {}
  const promise = new Promise<void>((resolve) => {
    open = resolve
  })
  return { promise, open }
}
