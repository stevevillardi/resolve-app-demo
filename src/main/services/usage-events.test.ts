import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestDb } from '../db/test-db'
import { contacts, personaTemplates } from '../db/schema'
import type { AppDatabase } from '../db'
import type { AgentUsage } from '../../shared/agent'

/**
 * Against a real :memory: SQLite with the checked-in migrations applied, so the
 * 0006 `session_id` column and the contact foreign key are exercised rather
 * than described. baselineFor()'s whole job is a query, and a mocked database
 * would leave that query untested.
 */

let db: AppDatabase
vi.mock('../db', () => ({ initDb: () => db }))

// agent-events imports `electron`, which the node test project has no window
// for. Mocking it also makes the announcement observable — see "announces the
// write" below, which is the only thing keeping an unattended routine's spend
// from sitting stale on a dashboard somebody is watching.
const emitUsageChanged = vi.fn()
vi.mock('./agent-events', () => ({ emitUsageChanged: (): void => emitUsageChanged() }))

const { baselineFor, listUsageEvents, recordUsage } = await import('./usage-events')

const SESSION = 'thread-01a00b86'

const USAGE: AgentUsage = {
  inputTokens: 12122,
  outputTokens: 5,
  cachedInputTokens: 4480,
  cacheWriteInputTokens: 0,
  reasoningOutputTokens: 0,
  costUsd: 0.0406,
  costSource: 'computed',
  model: 'gpt-5.5'
}

function seed(): void {
  db.insert(personaTemplates)
    .values({
      id: 'persona-1',
      name: 'Refactor Buddy',
      avatarColor: '#000',
      backend: 'codex',
      systemPrompt: 'You refactor code.',
      skillIds: [],
      sandbox: 'workspace_write',
      githubScope: 'read_only',
      model: null
    })
    .run()
  db.insert(contacts)
    .values({
      id: 'contact-1',
      personaTemplateId: 'persona-1',
      repoPath: '/Users/dev/my-app',
      displayName: 'Refactor Buddy',
      backendSessionId: null
    })
    .run()
  db.insert(contacts)
    .values({
      id: 'contact-2',
      personaTemplateId: 'persona-1',
      repoPath: '/Users/dev/my-app',
      displayName: 'Second',
      backendSessionId: null
    })
    .run()
}

beforeEach(() => {
  db = createTestDb()
  seed()
  emitUsageChanged.mockClear()
})

describe('recordUsage', () => {
  it('stamps the session so the next turn can subtract this one', () => {
    recordUsage('contact-1', 'message', USAGE, SESSION)
    expect(listUsageEvents('contact-1')[0].sessionId).toBe(SESSION)
  })

  it('leaves the session absent when the backend reported none', () => {
    // A turn that failed before `session_started` still spent tokens. The row
    // is worth keeping; it just cannot participate in a baseline.
    recordUsage('contact-1', 'message', USAGE, null)
    expect(listUsageEvents('contact-1')[0].sessionId).toBeUndefined()
  })

  it('attributes routine spend to its routine, and round-trips it', () => {
    // The id was always in hand at the call site and discarded until Phase 20
    // needed per-routine budgets. Plain attribution, not a FK — the figure
    // must survive the routine being deleted.
    recordUsage('contact-1', 'routine', USAGE, SESSION, 'routine-9')
    expect(listUsageEvents('contact-1')[0].routineId).toBe('routine-9')
  })

  it('leaves attribution absent rather than inventing one', () => {
    recordUsage('contact-1', 'message', USAGE, SESSION)
    expect(listUsageEvents('contact-1')[0].routineId).toBeUndefined()
  })

  it('announces the write', () => {
    // Written from the claim: this is what refreshes a spend view nobody's
    // thread is mounted for.
    recordUsage('contact-1', 'message', USAGE, SESSION)
    expect(emitUsageChanged).toHaveBeenCalledTimes(1)
  })

  it('announces every source, not just a user-sent message', () => {
    // A routine has no renderer subscribed to its runId and a summary is
    // recorded after its run is over, so these two are precisely the ones a
    // runId- or runs-based signal would have missed.
    for (const source of ['message', 'mention', 'routine', 'summary'] as const) {
      recordUsage('contact-1', source, USAGE, SESSION)
    }
    expect(emitUsageChanged).toHaveBeenCalledTimes(4)
  })
})

describe('baselineFor', () => {
  it('is null for a session with nothing recorded yet', () => {
    // A fresh thread. Codex's first reading is already this turn's own.
    expect(baselineFor('contact-1', SESSION)).toBeNull()
  })

  it('is null when no session id is known', () => {
    recordUsage('contact-1', 'message', USAGE, SESSION)
    expect(baselineFor('contact-1', null)).toBeNull()
  })

  it('sums the deltas already recorded for the session', () => {
    recordUsage('contact-1', 'message', USAGE, SESSION)
    recordUsage('contact-1', 'message', { ...USAGE, inputTokens: 13488, outputTokens: 5 }, SESSION)

    expect(baselineFor('contact-1', SESSION)).toMatchObject({
      inputTokens: 25610,
      outputTokens: 10,
      cachedInputTokens: 8960
    })
  })

  it('counts mention and summary spend too', () => {
    // Every turn on the thread moves Codex's cumulative counter, whoever asked
    // for it. Excluding a source would leave the baseline short and the next
    // turn over-reported by exactly that much.
    recordUsage('contact-1', 'message', USAGE, SESSION)
    recordUsage('contact-1', 'mention', USAGE, SESSION)
    expect(baselineFor('contact-1', SESSION)?.outputTokens).toBe(10)
  })

  it('ignores rows written before session ids were recorded', () => {
    // The upgrade path: pre-0006 rows carry NULL and cannot be attributed to a
    // thread, so an in-flight Codex conversation over-reports once more and is
    // exact from then on. Guessing which of them were deltas would be worse.
    recordUsage('contact-1', 'message', USAGE, null)
    expect(baselineFor('contact-1', SESSION)).toBeNull()
  })

  it('does not mix two contacts that share a session id', () => {
    recordUsage('contact-2', 'message', USAGE, SESSION)
    expect(baselineFor('contact-1', SESSION)).toBeNull()
  })

  it('does not carry a baseline across a new session on the same contact', () => {
    // A contact whose backend minted a fresh thread starts from zero again.
    recordUsage('contact-1', 'message', USAGE, SESSION)
    expect(baselineFor('contact-1', 'thread-other')).toBeNull()
  })

  it('reports no cost, because cost is recomputed from the delta', () => {
    // Differencing two cumulative dollar figures would bake in whatever price
    // table was live for each — the tokens are what get subtracted.
    recordUsage('contact-1', 'message', USAGE, SESSION)
    expect(baselineFor('contact-1', SESSION)?.costUsd).toBeNull()
  })
})
