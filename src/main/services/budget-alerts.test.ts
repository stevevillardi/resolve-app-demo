import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestDb } from '../db/test-db'
import { contacts, personaTemplates, routines, usageEvents } from '../db/schema'
import type { AppDatabase } from '../db/create'

/**
 * The edge-trigger, against a real :memory: db — the month window is a SQL
 * `gte` and the sticky map is an app_state row, so mocking either would leave
 * the actual mechanism untested.
 */

let db: AppDatabase
vi.mock('../db', () => ({ initDb: () => db }))

const sent: { title: string; body: string }[] = []
vi.mock('../notifications', () => ({
  sendNotification: (text: { title: string; body: string }): void => {
    sent.push(text)
  }
}))

const { checkBudgetsAfterUsage } = await import('./budget-alerts')
const { setAppStateNumber, getAppState } = await import('./app-state')

const NOW = new Date('2026-08-17T12:00:00').getTime()
const LAST_MONTH = new Date('2026-07-20T12:00:00').getTime()
const NEXT_MONTH = new Date('2026-09-02T12:00:00').getTime()

let eventCount = 0
function spend(timestamp: number, costUsd: number | null, routineId?: string): void {
  eventCount += 1
  db.insert(usageEvents)
    .values({
      id: `u-${eventCount}`,
      contactId: null,
      timestamp: new Date(timestamp),
      source: routineId ? 'routine' : 'message',
      inputTokens: 100,
      outputTokens: 10,
      costUsd,
      ...(routineId ? { routineId } : {})
    })
    .run()
}

function seedRoutine(id: string, monthlyBudgetUsd: number | null): void {
  db.insert(routines)
    .values({
      id,
      contactId: 'contact-1',
      schedule: '0 9 * * *',
      prompt: 'Sweep the flaky tests overnight.',
      enabled: true,
      monthlyBudgetUsd
    })
    .run()
}

beforeEach(() => {
  db = createTestDb()
  sent.length = 0
  eventCount = 0
  db.insert(personaTemplates)
    .values({
      id: 'persona-1',
      name: 'Sweeper',
      avatarColor: '#2a78d6',
      backend: 'claude',
      systemPrompt: 'Sweep.',
      skillIds: [],
      sandbox: 'workspace_write',
      githubScope: 'open_pr',
      model: null
    })
    .run()
  db.insert(contacts)
    .values({
      id: 'contact-1',
      personaTemplateId: 'persona-1',
      repoPath: '/repo',
      displayName: 'Sweeper',
      backendSessionId: null
    })
    .run()
})

describe('the app-level budget', () => {
  it('alerts once on the first crossing, then stays quiet for the month', () => {
    setAppStateNumber('monthly_budget_usd', 5)
    spend(NOW - 1000, 6)

    checkBudgetsAfterUsage({ timestamp: NOW })
    expect(sent).toHaveLength(1)
    expect(sent[0].title).toBe('Monthly budget crossed')

    // The very next turn also lands over budget — the sticky map is what
    // stops a toast per turn for the rest of the month.
    spend(NOW, 1)
    checkBudgetsAfterUsage({ timestamp: NOW })
    expect(sent).toHaveLength(1)
  })

  it('re-arms when the month rolls over', () => {
    setAppStateNumber('monthly_budget_usd', 5)
    spend(NOW - 1000, 6)
    checkBudgetsAfterUsage({ timestamp: NOW })
    expect(sent).toHaveLength(1)

    spend(NEXT_MONTH - 1000, 6)
    checkBudgetsAfterUsage({ timestamp: NEXT_MONTH })
    expect(sent).toHaveLength(2)
  })

  it("ignores last month's spend entirely", () => {
    setAppStateNumber('monthly_budget_usd', 5)
    spend(LAST_MONTH, 100)
    spend(NOW - 1000, 1)

    checkBudgetsAfterUsage({ timestamp: NOW })
    expect(sent).toHaveLength(0)
  })

  // The seam comment's rule, honoured rather than worked around: a floor of
  // $0 crosses nothing, however much unpriced work actually ran.
  it('never alerts on an all-unpriced month', () => {
    setAppStateNumber('monthly_budget_usd', 5)
    spend(NOW - 2000, null)
    spend(NOW - 1000, null)

    checkBudgetsAfterUsage({ timestamp: NOW })
    expect(sent).toHaveLength(0)
  })

  it('says "at least" when priced spend crosses with unpriced turns present', () => {
    setAppStateNumber('monthly_budget_usd', 5)
    spend(NOW - 2000, 6)
    spend(NOW - 1000, null)

    checkBudgetsAfterUsage({ timestamp: NOW })
    expect(sent[0].body).toContain('at least $6.00')
  })

  it('does nothing with no budget set', () => {
    spend(NOW - 1000, 1000)
    checkBudgetsAfterUsage({ timestamp: NOW })
    expect(sent).toHaveLength(0)
  })
})

describe('the per-routine budget', () => {
  it("alerts on the routine's own spend, independently of the app scope", () => {
    seedRoutine('routine-1', 2)
    spend(NOW - 2000, 3, 'routine-1')
    spend(NOW - 1000, 50) // other spend, not the routine's

    checkBudgetsAfterUsage({ timestamp: NOW, routineId: 'routine-1' })

    expect(sent).toHaveLength(1)
    expect(sent[0].body).toContain('Sweep the flaky tests overnight.')
  })

  it("only counts that routine's events toward its threshold", () => {
    seedRoutine('routine-1', 10)
    spend(NOW - 2000, 50, 'routine-2')
    spend(NOW - 1000, 1, 'routine-1')

    checkBudgetsAfterUsage({ timestamp: NOW, routineId: 'routine-1' })
    expect(sent).toHaveLength(0)
  })

  it('edge-triggers per routine, and both scopes can fire from one turn', () => {
    setAppStateNumber('monthly_budget_usd', 4)
    seedRoutine('routine-1', 2)
    spend(NOW - 1000, 5, 'routine-1')

    checkBudgetsAfterUsage({ timestamp: NOW, routineId: 'routine-1' })
    expect(sent).toHaveLength(2)

    spend(NOW, 1, 'routine-1')
    checkBudgetsAfterUsage({ timestamp: NOW, routineId: 'routine-1' })
    expect(sent).toHaveLength(2)
  })

  it('ignores a routine with no budget of its own', () => {
    seedRoutine('routine-1', null)
    spend(NOW - 1000, 100, 'routine-1')

    checkBudgetsAfterUsage({ timestamp: NOW, routineId: 'routine-1' })
    expect(sent).toHaveLength(0)
  })
})

describe('the sticky map', () => {
  it('prunes spent months on write, so deleted routines cannot pile up', () => {
    setAppStateNumber('monthly_budget_usd', 5)
    seedRoutine('routine-1', 2)
    spend(NOW - 1000, 6, 'routine-1')
    checkBudgetsAfterUsage({ timestamp: NOW, routineId: 'routine-1' })

    spend(NEXT_MONTH - 1000, 6)
    checkBudgetsAfterUsage({ timestamp: NEXT_MONTH })

    const map = JSON.parse(getAppState('budget_alerts_fired') ?? '{}') as Record<string, string>
    expect(map).toEqual({ app: '2026-09' })
  })
})
