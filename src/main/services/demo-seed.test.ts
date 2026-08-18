import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestDb } from '../db/test-db'
import {
  appState,
  contacts,
  groupMessages,
  groups,
  messages,
  personaTemplates,
  routines,
  skills,
  toolCalls,
  usageEvents
} from '../db/schema'
import type { AppDatabase } from '../db/create'

let db: AppDatabase
vi.mock('../db', () => ({ initDb: () => db }))

const { PRESERVED_APP_STATE, seedDemoData, wipeForDemo } = await import('./demo-seed')
const { searchMessages } = await import('./search')
const { getAppState } = await import('./app-state')

const NOW = Date.parse('2026-08-17T15:00:00Z')

function layout(): Parameters<typeof seedDemoData>[0] {
  return {
    now: NOW,
    appRepo: '/repos/switchboard',
    siteRepo: '/repos/switchboard-site',
    ids: {
      reviewer: 'c-reviewer',
      hunter: 'c-hunter',
      tester: 'c-tester',
      docs: 'c-docs',
      refactor: 'c-refactor',
      release: 'c-release'
    },
    refactor: {
      path: '/worktrees/switchboard-site/refactor-buddy-cref',
      branch: 'persona/refactor-buddy-cref',
      headBefore: 'a'.repeat(40),
      headAfter: 'b'.repeat(40)
    },
    tester: {
      path: '/worktrees/switchboard/test-author-ctes',
      branch: 'persona/test-author-ctes'
    }
  }
}

beforeEach(() => {
  db = createTestDb()
})

describe('wipeForDemo', () => {
  it('empties the content tables but keeps identity app-state', () => {
    seedDemoData(layout())
    db.insert(appState).values({ key: 'github_account_login', value: 'stevevillardi' }).run()
    db.insert(appState).values({ key: 'github_token_state', value: 'ok' }).run()
    db.insert(appState).values({ key: 'workspace_root', value: '/Users/steve/code' }).run()

    wipeForDemo()

    for (const table of [
      contacts,
      groups,
      messages,
      groupMessages,
      toolCalls,
      routines,
      usageEvents,
      personaTemplates,
      skills
    ]) {
      expect(db.select().from(table).all()).toHaveLength(0)
    }
    // Identity survives; content-level state does not.
    expect(getAppState('github_account_login')).toBe('stevevillardi')
    expect(getAppState('github_token_state')).toBe('ok')
    expect(getAppState('workspace_root')).toBe('/Users/steve/code')
    expect(getAppState('monthly_budget_usd')).toBeNull()
    expect(getAppState('seed_version')).toBeNull()
  })

  it('preserves only keys that are actually in the app-state vocabulary', () => {
    // A typo in the preserve list would silently wipe a key it meant to keep.
    for (const key of PRESERVED_APP_STATE) {
      db.insert(appState).values({ key, value: 'kept' }).run()
    }
    wipeForDemo()
    expect(db.select().from(appState).all()).toHaveLength(PRESERVED_APP_STATE.length)
  })
})

describe('seedDemoData', () => {
  beforeEach(() => {
    seedDemoData(layout())
  })

  it('gives every section content: contacts on two repos, both groups, routines, spend', () => {
    const contactRows = db.select().from(contacts).all()
    expect(contactRows).toHaveLength(6)
    expect(new Set(contactRows.map((row) => row.repoPath)).size).toBe(2)

    expect(db.select().from(groups).all()).toHaveLength(2)
    expect(db.select().from(routines).all()).toHaveLength(3)
    expect(db.select().from(usageEvents).all().length).toBeGreaterThanOrEqual(15)

    // Every contact's thread has at least one message, so no row previews empty.
    const byContact = new Set(
      db
        .select()
        .from(messages)
        .all()
        .map((row) => row.contactId)
    )
    for (const row of contactRows) expect(byContact.has(row.id)).toBe(true)
  })

  it('keeps its own foreign keys honest: personas installed, their skills installed', () => {
    const skillIds = new Set(
      db
        .select()
        .from(skills)
        .all()
        .map((row) => row.id)
    )
    const personas = db.select().from(personaTemplates).all()
    expect(personas).toHaveLength(6)
    for (const persona of personas) {
      for (const skillId of persona.skillIds) {
        expect(skillIds.has(skillId)).toBe(true)
      }
    }
  })

  it('covers all five group message shapes, with the branch ask still standing', () => {
    const rows = db.select().from(groupMessages).all()
    expect(new Set(rows.map((row) => row.type))).toEqual(
      new Set(['system_summary', 'user_mention', 'agent_reply', 'routine_run', 'branch_request'])
    )

    const ask = rows.find((row) => row.type === 'branch_request')
    expect(ask?.branch).toBe(layout().refactor.branch)
    expect(ask?.resolvedAt).toBeNull()

    const decisions = rows.filter((row) => row.durable)
    expect(decisions.length).toBeGreaterThanOrEqual(2)
  })

  it('stages routine history in all three states the list can show', () => {
    const rows = db.select().from(routines).all()

    const behind = rows.find((row) => row.enabled && row.missedRunCount > 0)
    expect(behind?.lastRunAt).not.toBeNull()
    expect(behind?.lastMissedAt).not.toBeNull()

    const paused = rows.filter((row) => !row.enabled)
    expect(paused.length).toBeGreaterThanOrEqual(2)
    for (const routine of paused) {
      expect(routine.lastRunAt).not.toBeNull()
      expect(routine.lastRunSummary).not.toBeNull()
    }
  })

  it('spreads spend across every source, attributes routine runs, and keeps one turn unpriced', () => {
    const rows = db.select().from(usageEvents).all()
    expect(new Set(rows.map((row) => row.source))).toEqual(
      new Set(['message', 'routine', 'mention', 'summary'])
    )
    expect(rows.some((row) => row.source === 'routine' && row.routineId !== null)).toBe(true)
    expect(rows.filter((row) => row.costUsd === null)).toHaveLength(1)
    // Both backends' models appear, so the dashboard's per-model split has rows.
    const models = new Set(rows.map((row) => row.model))
    expect([...models].some((model) => model?.startsWith('claude'))).toBe(true)
    expect([...models].some((model) => model?.startsWith('gpt'))).toBe(true)
  })

  it('leaves one thread interrupted: a trailing user message and an orphaned failed call', () => {
    const docs = db
      .select()
      .from(messages)
      .all()
      .filter((row) => row.contactId === 'c-docs')
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
    expect(docs.at(-1)?.role).toBe('user')

    const orphan = db
      .select()
      .from(toolCalls)
      .all()
      .find((row) => row.contactId === 'c-docs' && row.messageId === null)
    expect(orphan?.status).toBe('failed')
  })

  it('backdates read boundaries so a thread and a group arrive unread', () => {
    const reviewer = db
      .select()
      .from(contacts)
      .all()
      .find((row) => row.id === 'c-reviewer')
    const latest = db
      .select()
      .from(messages)
      .all()
      .filter((row) => row.contactId === 'c-reviewer')
      .map((row) => row.timestamp.getTime())
      .sort((a, b) => b - a)[0]
    expect(reviewer?.lastReadAt?.getTime()).toBeLessThan(latest)

    const appGroup = db
      .select()
      .from(groups)
      .all()
      .find((row) => row.id === 'demo-group-app')
    const latestGroupRow = db
      .select()
      .from(groupMessages)
      .all()
      .filter((row) => row.groupId === 'demo-group-app')
      .map((row) => row.timestamp.getTime())
      .sort((a, b) => b - a)[0]
    expect(appGroup?.lastReadAt?.getTime()).toBeLessThan(latestGroupRow)
  })

  it('is findable through message search — the direct inserts went through the FTS triggers', () => {
    const results = searchMessages('spacing')
    expect(results.length).toBeGreaterThan(0)
    expect(new Set(results.map((row) => row.kind))).toEqual(new Set(['message', 'group_message']))
  })

  it('stamps the work chip from the layout, so the chip and the real branch agree', () => {
    const chipped = db
      .select()
      .from(messages)
      .all()
      .find((row) => row.work !== null)
    expect(chipped?.work?.branch).toBe(layout().refactor.branch)
    expect(chipped?.work?.committed).toContain('styles.css')
    expect(chipped?.work?.dirty).toContain('index.html')
  })

  it('marks the profile seeded and onboarded, so startup neither reseeds nor rewizards', () => {
    expect(getAppState('seed_version')).toBe('1')
    expect(getAppState('onboarding_completed')).toBe('true')
    expect(getAppState('monthly_budget_usd')).not.toBeNull()
  })

  it('can be restaged: wipe and reseed land the identical shape', () => {
    const before = db.select().from(messages).all().length
    wipeForDemo()
    seedDemoData(layout())
    expect(db.select().from(messages).all().length).toBe(before)
    expect(db.select().from(contacts).all()).toHaveLength(6)
  })
})
