import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestDb } from '../db/test-db'
import { groupMessages, groups, routines, usageEvents } from '../db/schema'
import {
  createTurnHarness,
  openableGate,
  REPO,
  seedContact,
  seedPersona,
  seedSkill,
  settle
} from './test-support/turn-harness'
import type { AppDatabase } from '../db/create'
import type { CronEngine, CronHandle } from './scheduler'

/**
 * The scheduler, against a fake cron engine and a scripted backend.
 *
 * No wall-clock time passes anywhere in this file — the engine is a port, so a
 * "fire" is a function call. What is *not* faked is the turn pipeline: these
 * run through the real `startTurn`, because the claim under test is that a
 * routine reuses it rather than reimplementing it, and a mocked pipeline would
 * prove nothing about that.
 */

let db: AppDatabase
const harness = createTurnHarness()

vi.mock('../db', () => ({ initDb: () => db }))
vi.mock('./agent-events', () => ({
  emitAgentEvent: () => {},
  emitRunsChanged: () => {},
  emitUsageChanged: () => {},
  emitMessagesChanged: () => {}
}))
vi.mock('./adapter-host', () => ({ adapterForBackend: () => harness.adapter }))

/**
 * The OS toast stubbed to a log: this file asserts *when* the scheduler
 * notifies and with what, while notifications.test.ts owns what a notification
 * does with it (targets, the enabled flag, the electron binding).
 */
const notified: { prompt: string; status: string; summary: string }[] = []
vi.mock('../notifications', () => ({
  notifyTurnFinished: () => {},
  notifyRoutineOutcome: (
    routine: { prompt: string },
    result: { status: string; summary: string }
  ) => notified.push({ prompt: routine.prompt, ...result })
}))

/**
 * Compaction stubbed to a fixed verdict: this file asserts what the *scheduler*
 * does with a summary, not how one is produced. `compaction.test.ts` owns that,
 * including that a routine origin writes `routine_run`.
 */
let summaryResult: {
  id: string
  summary: string
  category: 'decision' | 'tradeoff' | 'routine'
  durable: boolean
} | null = null
const summarized: { contactId: string; prompt: string; reply: string; kind: string }[] = []
vi.mock('./compaction', () => ({
  summarizeTurn: async (
    contactId: string,
    prompt: string,
    reply: string,
    origin: { kind: string }
  ) => {
    summarized.push({ contactId, prompt, reply, kind: origin.kind })
    return summaryResult
  }
}))

/**
 * The pull-request action stubbed for the same reason compaction is: what this
 * file asserts is what the *scheduler* does with the result — whether it fires
 * at all, and how a refusal is reported — while `pull-requests.test.ts` owns
 * whether a pull request should have been opened. Leaving it real would also
 * spawn git against a repo path that does not exist.
 */
let prAvailable = false
let prResult: { number: number; url: string; title: string; action: string } | Error = new Error(
  'not configured'
)
const prAttempts: string[] = []
vi.mock('./pull-requests', () => ({
  pullRequestState: async () => ({ available: prAvailable, pr: null }),
  openPullRequest: async (contactId: string) => {
    prAttempts.push(contactId)
    if (prResult instanceof Error) throw prResult
    return prResult
  }
}))

const { fireRoutine, armedRoutineIds, nextRuns, startScheduler, stopScheduler, syncSchedules } =
  await import('./scheduler')
const { acquire, resetRunLocks } = await import('./run-lock')
const { listMessages } = await import('./messaging')
const { createRoutine, getRoutine } = await import('./routines')

// --- A cron engine that never touches a timer -------------------------------

interface FakeTask {
  expression: string
  onTick: () => void
  nextRun: Date | null
  destroyed: boolean
}

class FakeCronEngine implements CronEngine {
  readonly tasks = new Map<string, FakeTask>()
  /** Counts handles ever handed out, so "kept the same handle" is assertable. */
  handles = 0

  schedule(expression: string, onTick: () => void, name: string): CronHandle {
    if (expression.includes('bad')) throw new Error(`invalid expression: ${expression}`)

    this.handles += 1
    const task: FakeTask = {
      expression,
      onTick,
      nextRun: new Date('2026-08-17T09:00:00Z'),
      destroyed: false
    }
    this.tasks.set(name, task)

    return {
      destroy: () => {
        task.destroyed = true
        this.tasks.delete(name)
      },
      getNextRun: () => task.nextRun
    }
  }

  /** Fires a routine the way a real cron tick would. */
  tick(name: string): void {
    const task = this.tasks.get(name)
    if (!task) throw new Error(`no task armed for ${name}`)
    task.onTick()
  }
}

let engine: FakeCronEngine

// --- Fixtures ---------------------------------------------------------------

function seedRoutine(
  id: string,
  contactId: string,
  overrides: Partial<{
    schedule: string
    prompt: string
    enabled: boolean
  }> = {}
): void {
  db.insert(routines)
    .values({
      id,
      contactId,
      schedule: overrides.schedule ?? '0 9 * * *',
      prompt: overrides.prompt ?? 'Check for new issues and fix the trivial ones.',
      enabled: overrides.enabled ?? true,
      lastRunAt: null,
      lastRunSummary: null
    })
    .run()
}

/**
 * One expectation, shared by the cron path and the Run-now path.
 *
 * Deliberately a single helper rather than two parallel assertion blocks:
 * function identity is not observable through a closure, so "provably the same
 * path" is tested as identical observable effects — and two copies of the
 * expectation could drift into agreeing about different things.
 */
function expectRoutineRan(routineId: string, contactId: string, reply = 'Looks good.'): void {
  const thread = listMessages(contactId)
  expect(thread.map((message) => message.role)).toEqual(['user', 'assistant'])
  expect(thread[1].content).toBe(reply)

  const usage = db.select().from(usageEvents).all()
  expect(usage).toHaveLength(1)
  expect(usage[0].source).toBe('routine')

  const routine = getRoutine(routineId)
  expect(routine?.lastRunAt).not.toBeNull()
  expect(routine?.lastRunSummary).toBeTruthy()
}

beforeEach(() => {
  db = createTestDb()
  resetRunLocks()
  stopScheduler()
  harness.reset()
  summarized.length = 0
  summaryResult = null
  prAvailable = false
  prResult = new Error('not configured')
  prAttempts.length = 0
  notified.length = 0
  engine = new FakeCronEngine()

  seedSkill(db)
  seedPersona(db, 'persona-write', 'workspace_write')
  seedPersona(db, 'persona-read', 'read_only')
  seedContact(db, 'contact-writer', 'persona-write')
  seedContact(db, 'contact-reader', 'persona-read')
  db.insert(groups).values({ id: 'group-1', repoPath: REPO }).run()
})

// --- The equivalence the blueprint asks to be able to state ------------------

describe('a scheduled fire and Run now are the same path', () => {
  it('runs the routine when cron ticks', async () => {
    seedRoutine('routine-1', 'contact-writer')
    startScheduler(engine)

    engine.tick('routine-1')
    await settle()

    expectRoutineRan('routine-1', 'contact-writer')
  })

  it('runs the routine when Run now is pressed', async () => {
    seedRoutine('routine-1', 'contact-writer')
    startScheduler(engine)

    await fireRoutine('routine-1').completed

    expectRoutineRan('routine-1', 'contact-writer')
  })
})

// --- Acceptance checks: the run lock, both directions ------------------------

describe('contention with a writer already holding the repo', () => {
  function holdExclusive(): void {
    acquire({
      runId: 'other-run',
      contactId: 'contact-writer',
      contactName: 'Refactor Buddy',
      workingPath: REPO,
      mode: 'exclusive',
      startedAt: Date.now()
    })
  }

  // The acceptance check, written from the claim: a writing routine fired into
  // a held repo must skip *and say why*, not run concurrently and not silently
  // do nothing.
  it('skips a writing routine and records the reason in lastRunSummary', async () => {
    seedRoutine('routine-1', 'contact-writer')
    startScheduler(engine)
    holdExclusive()

    const result = await fireRoutine('routine-1').completed

    expect(result.status).toBe('skipped')
    const routine = getRoutine('routine-1')
    expect(routine?.lastRunSummary).toMatch(/Refactor Buddy is already working here/)
    // Recorded as an attempt: otherwise the list says "Never run" for a routine
    // that has been skipping nightly for a week.
    expect(routine?.lastRunAt).not.toBeNull()
    // A refused turn leaves no trace in the thread — the rule Phase 6 set.
    expect(listMessages('contact-writer')).toHaveLength(0)
  })

  // The other direction, and the reason Phase 6 narrowed §15D at all: readers
  // are never refused, so a read_only routine is unaffected by a writer.
  it('runs a read_only routine normally', async () => {
    seedRoutine('routine-2', 'contact-reader')
    startScheduler(engine)
    holdExclusive()

    const result = await fireRoutine('routine-2').completed

    expect(result.status).toBe('completed')
    expectRoutineRan('routine-2', 'contact-reader')
  })
})

// --- The toast (Phase 20) ----------------------------------------------------

describe('outcome notifications', () => {
  it('notifies a completed run with its summary', async () => {
    seedRoutine('routine-1', 'contact-writer')
    startScheduler(engine)

    await fireRoutine('routine-1').completed

    expect(notified).toHaveLength(1)
    expect(notified[0].status).toBe('completed')
    expect(notified[0].prompt).toContain('Check for new issues')
  })

  it('notifies a failed run as a failure', async () => {
    seedRoutine('routine-1', 'contact-writer')
    startScheduler(engine)
    harness.script = [
      { type: 'error', kind: 'rate_limit', message: 'Rate limited.' },
      { type: 'done', finalText: '', usage: null }
    ]

    await fireRoutine('routine-1').completed

    expect(notified).toHaveLength(1)
    expect(notified[0].status).toBe('failed')
  })

  // The decision this phase records: a lock-refused unattended fire is
  // precisely the silence being ended, so a skip notifies too.
  it('notifies a lock-refused skip', async () => {
    seedRoutine('routine-1', 'contact-writer')
    startScheduler(engine)
    acquire({
      runId: 'other-run',
      contactId: 'contact-writer',
      contactName: 'Refactor Buddy',
      workingPath: REPO,
      mode: 'exclusive',
      startedAt: Date.now()
    })

    const result = await fireRoutine('routine-1').completed

    expect(result.status).toBe('skipped')
    expect(notified).toHaveLength(1)
    expect(notified[0].status).toBe('skipped')
  })

  // Fires that were never attempts write no history and make no sound — a
  // toast for a routine that no longer exists would name nothing clickable.
  it('stays silent for a fire that was never an attempt', async () => {
    startScheduler(engine)
    await fireRoutine('routine-gone').completed
    expect(notified).toHaveLength(0)
  })
})

// --- Bookkeeping timing ------------------------------------------------------

describe('run history', () => {
  it('is written only once the turn has finished', async () => {
    seedRoutine('routine-1', 'contact-writer')
    startScheduler(engine)
    const gate = openableGate()
    harness.gate = gate

    const fire = fireRoutine('routine-1')
    await settle()

    // Mid-flight: the turn is running and nothing has been recorded yet.
    expect(fire.runId).not.toBeNull()
    expect(getRoutine('routine-1')?.lastRunAt).toBeNull()
    expect(db.select().from(groupMessages).all()).toHaveLength(0)

    gate.open()
    await fire.completed
    expect(getRoutine('routine-1')?.lastRunAt).not.toBeNull()
  })

  it('prefers the summariser sentence over the raw reply', async () => {
    summaryResult = {
      id: 'gm-1',
      summary: 'Cached the token read in auth.ts.',
      category: 'decision',
      durable: true
    }
    seedRoutine('routine-1', 'contact-writer')
    startScheduler(engine)

    await fireRoutine('routine-1').completed

    expect(getRoutine('routine-1')?.lastRunSummary).toBe('Cached the token read in auth.ts.')
  })

  it('records why a failed turn failed, not just that it produced nothing', async () => {
    harness.script = [
      { type: 'error', kind: 'auth', message: 'Not authenticated.' },
      { type: 'done', finalText: '', usage: null }
    ]
    seedRoutine('routine-1', 'contact-writer')
    startScheduler(engine)

    const result = await fireRoutine('routine-1').completed

    expect(result.status).toBe('failed')
    expect(getRoutine('routine-1')?.lastRunSummary).toBe('Failed — Not authenticated.')
  })

  it('tells the summariser this was a routine, so it files a routine_run', async () => {
    seedRoutine('routine-1', 'contact-writer')
    startScheduler(engine)

    await fireRoutine('routine-1').completed

    expect(summarized).toHaveLength(1)
    expect(summarized[0].kind).toBe('routine')
  })
})

// --- Arming ------------------------------------------------------------------

describe('syncSchedules', () => {
  it('arms exactly the enabled routines', () => {
    seedRoutine('routine-1', 'contact-writer')
    seedRoutine('routine-2', 'contact-reader', { enabled: false })
    startScheduler(engine)

    expect(armedRoutineIds()).toEqual(['routine-1'])
  })

  it('disarms a routine that has been disabled, without a restart', () => {
    seedRoutine('routine-1', 'contact-writer')
    startScheduler(engine)

    db.update(routines).set({ enabled: false }).run()
    syncSchedules()

    expect(armedRoutineIds()).toEqual([])
  })

  it('re-arms when the expression changes', () => {
    seedRoutine('routine-1', 'contact-writer')
    startScheduler(engine)

    db.update(routines).set({ schedule: '0 */6 * * *' }).run()
    syncSchedules()

    expect(engine.tasks.get('routine-1')?.expression).toBe('0 */6 * * *')
  })

  // Rebuilding every task on any change would move an unrelated routine's next
  // fire time every time something else was edited.
  it('keeps the existing handle when the expression is unchanged', () => {
    seedRoutine('routine-1', 'contact-writer')
    startScheduler(engine)
    const handlesAfterFirstArm = engine.handles

    db.update(routines).set({ prompt: 'a different prompt' }).run()
    syncSchedules()

    expect(engine.handles).toBe(handlesAfterFirstArm)
  })

  // One bad row must not take the scheduler down with it.
  it('skips a routine the engine refuses and still arms the others', () => {
    seedRoutine('routine-bad', 'contact-writer', { schedule: 'bad expression' })
    seedRoutine('routine-good', 'contact-reader')

    expect(() => startScheduler(engine)).not.toThrow()
    expect(armedRoutineIds()).toEqual(['routine-good'])
  })
})

// --- fireRoutine edge cases ---------------------------------------------------

describe('fireRoutine', () => {
  it('no-ops for a routine that has been deleted since it was armed', async () => {
    seedRoutine('routine-1', 'contact-writer')
    startScheduler(engine)
    db.delete(routines).run()

    const result = await fireRoutine('routine-1').completed

    expect(result.status).toBe('skipped')
    expect(listMessages('contact-writer')).toHaveLength(0)
  })

  // Run now is a manual override: testing a routine before switching it on is
  // the whole reason the button exists.
  it('runs a disabled routine when triggered manually', async () => {
    seedRoutine('routine-1', 'contact-writer', { enabled: false })
    startScheduler(engine)

    const result = await fireRoutine('routine-1').completed

    expect(result.status).toBe('completed')
    expectRoutineRan('routine-1', 'contact-writer')
  })

  // Guarded by our own in-flight set rather than node-cron's noOverlap, which
  // knows nothing about the manual path and so could not stop a button press
  // landing on top of a tick.
  it('skips a second fire while the first is still running, without touching history', async () => {
    seedRoutine('routine-1', 'contact-writer')
    startScheduler(engine)
    const gate = openableGate()
    harness.gate = gate

    const first = fireRoutine('routine-1')
    await settle()
    const second = await fireRoutine('routine-1').completed

    expect(second.status).toBe('skipped')
    expect(second.summary).toBe('Already running.')
    expect(getRoutine('routine-1')?.lastRunAt).toBeNull()

    gate.open()
    await first.completed
  })
})

// --- The unattended pull request (Phase 9, blueprint §16 Journey 3) -----------

describe('a routine that made changes ends by opening a pull request', () => {
  it('opens one and says so in the run history', async () => {
    prAvailable = true
    prResult = {
      number: 12,
      url: 'https://github.com/acme/app/pull/12',
      title: 'Fix the parser',
      action: 'created'
    }
    seedRoutine('routine-1', 'contact-writer')
    startScheduler(engine)

    const result = await fireRoutine('routine-1').completed

    expect(prAttempts).toEqual(['contact-writer'])
    expect(result.status).toBe('completed')
    // The run's own summary survives; the PR is appended to it, because both are
    // things the user wants from one line in a list.
    expect(getRoutine('routine-1')?.lastRunSummary).toContain('Opened PR #12.')
  })

  it('comments instead when the branch already had one open', async () => {
    prAvailable = true
    prResult = {
      number: 12,
      url: 'https://github.com/acme/app/pull/12',
      title: 'Fix the parser',
      action: 'commented'
    }
    seedRoutine('routine-1', 'contact-writer')
    startScheduler(engine)

    await fireRoutine('routine-1').completed

    expect(getRoutine('routine-1')?.lastRunSummary).toContain('Commented on PR #12.')
  })

  // The Contact has no pull-request path — a plain folder, no GitHub remote, or
  // a read_only persona. Not a misconfiguration and not worth reporting.
  it('says nothing when there is no pull-request path', async () => {
    seedRoutine('routine-1', 'contact-writer')
    startScheduler(engine)

    await fireRoutine('routine-1').completed

    expect(prAttempts).toEqual([])
    expect(getRoutine('routine-1')?.lastRunSummary).not.toContain('PR')
  })

  /**
   * The run did its work. Reporting it as failed because a push was refused
   * would misrepresent what happened — and there is nobody at the screen to
   * read the difference, so the record has to carry it.
   */
  it('records a refusal without failing the run', async () => {
    prAvailable = true
    prResult = new Error('Refactor Buddy left 2 uncommitted changes in its working copy.')
    seedRoutine('routine-1', 'contact-writer')
    startScheduler(engine)

    const result = await fireRoutine('routine-1').completed

    expect(result.status).toBe('completed')
    expect(getRoutine('routine-1')?.lastRunSummary).toContain('2 uncommitted changes')
  })

  it('does not attempt one for a run that failed', async () => {
    prAvailable = true
    harness.throwOnRun = new Error('the backend fell over')
    seedRoutine('routine-1', 'contact-writer')
    startScheduler(engine)

    const result = await fireRoutine('routine-1').completed

    expect(result.status).toBe('failed')
    expect(prAttempts).toEqual([])
  })
})

// --- The tray's data ----------------------------------------------------------

describe('nextRuns', () => {
  it('is empty before anything is armed', () => {
    startScheduler(engine)
    expect(nextRuns()).toEqual([])
  })

  // A disabled routine is never scheduled, so reporting a next-fire time for it
  // would be a lie the tray menu tells every time it opens.
  it('lists only armed routines', () => {
    seedRoutine('routine-1', 'contact-writer')
    seedRoutine('routine-2', 'contact-reader', { enabled: false })
    startScheduler(engine)

    expect(nextRuns().map((run) => run.routineId)).toEqual(['routine-1'])
    expect(nextRuns()[0].nextRun).toBe(Date.parse('2026-08-17T09:00:00Z'))
  })
})

describe('createRoutine', () => {
  // Main is the guarantee, the renderer is the UX — a schedule the scheduler
  // could never arm must not reach the table by any route.
  it('refuses a schedule that is not a cron expression', () => {
    expect(() =>
      createRoutine({
        contactId: 'contact-writer',
        schedule: 'every so often',
        prompt: 'do the thing',
        enabled: true
      })
    ).toThrow(/won't run/)
  })
})
