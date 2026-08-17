import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestDb } from '../db/test-db'
import { contacts, personaTemplates } from '../db/schema'
import type { AppDatabase } from '../db/create'

let db: AppDatabase
vi.mock('../db', () => ({ initDb: () => db }))

const {
  createRoutine,
  deleteRoutine,
  getRoutine,
  listEnabledRoutines,
  listRoutines,
  recordMissedRun,
  recordRunOutcome,
  updateRoutine
} = await import('./routines')

const CONTACT = 'contact-1'

function draft(overrides: Partial<{ schedule: string; prompt: string; enabled: boolean }> = {}): {
  contactId: string
  schedule: string
  prompt: string
  enabled: boolean
  monthlyBudgetUsd: number | null
} {
  return {
    contactId: CONTACT,
    schedule: overrides.schedule ?? '0 9 * * *',
    prompt: overrides.prompt ?? 'Check for new issues.',
    enabled: overrides.enabled ?? true,
    monthlyBudgetUsd: null
  }
}

beforeEach(() => {
  db = createTestDb()
  db.insert(personaTemplates)
    .values({
      id: 'persona-1',
      name: 'Refactor Buddy',
      avatarColor: '#2a78d6',
      backend: 'claude',
      systemPrompt: 'Refactor carefully.',
      skillIds: [],
      sandbox: 'workspace_write',
      githubScope: 'open_pr',
      model: null
    })
    .run()
  db.insert(contacts)
    .values({
      id: CONTACT,
      personaTemplateId: 'persona-1',
      repoPath: '/Users/dev/my-app',
      displayName: 'Refactor Buddy',
      backendSessionId: null
    })
    .run()
})

describe('createRoutine', () => {
  it('mints the id and starts with no run history', () => {
    const routine = createRoutine(draft())

    expect(routine.id).toBeTruthy()
    expect(routine.lastRunAt).toBeNull()
    expect(routine.lastRunSummary).toBeNull()
    expect(getRoutine(routine.id)).toEqual(routine)
  })

  it('refuses a schedule the scheduler could never arm', () => {
    expect(() => createRoutine(draft({ schedule: 'nightly-ish' }))).toThrow(/won't run/)
    expect(listRoutines()).toHaveLength(0)
  })
})

describe('updateRoutine', () => {
  it('saves every editable field', () => {
    const created = createRoutine(draft())

    const saved = updateRoutine({
      id: created.id,
      contactId: CONTACT,
      schedule: '0 */6 * * *',
      prompt: 'Review open PRs.',
      enabled: false,
      monthlyBudgetUsd: null
    })

    expect(saved.schedule).toBe('0 */6 * * *')
    expect(saved.prompt).toBe('Review open PRs.')
    expect(saved.enabled).toBe(false)
  })

  /**
   * The reason the update shape omits run history rather than taking a whole
   * routine: an editor open across a fire would otherwise save its stale copy
   * back over what the fire recorded, and the run would vanish with nothing
   * to show it had ever happened.
   */
  it('cannot clobber run history written while the editor was open', () => {
    const created = createRoutine(draft())
    recordRunOutcome(created.id, 'Fixed 2 lint errors.', 1_755_000_000_000)

    updateRoutine({
      id: created.id,
      contactId: CONTACT,
      schedule: '0 9 * * *',
      prompt: 'a newly typed prompt',
      enabled: true,
      monthlyBudgetUsd: null
    })

    const after = getRoutine(created.id)
    expect(after?.lastRunSummary).toBe('Fixed 2 lint errors.')
    expect(after?.lastRunAt).toBe(1_755_000_000_000)
  })

  it('refuses an invalid schedule on the way in', () => {
    const created = createRoutine(draft())

    expect(() =>
      updateRoutine({
        id: created.id,
        contactId: CONTACT,
        schedule: 'whenever',
        prompt: 'x',
        enabled: true,
        monthlyBudgetUsd: null
      })
    ).toThrow(/won't run/)
    expect(getRoutine(created.id)?.schedule).toBe('0 9 * * *')
  })

  it('reports a routine that is not there', () => {
    expect(() =>
      updateRoutine({
        id: 'nope',
        contactId: CONTACT,
        schedule: '0 9 * * *',
        prompt: 'x',
        enabled: true,
        monthlyBudgetUsd: null
      })
    ).toThrow(/No such routine/)
  })
})

describe('listEnabledRoutines', () => {
  it('is what the scheduler arms, and excludes the paused ones', () => {
    createRoutine(draft({ prompt: 'on' }))
    createRoutine(draft({ prompt: 'off', enabled: false }))

    expect(listEnabledRoutines().map((routine) => routine.prompt)).toEqual(['on'])
  })
})

describe('deleteRoutine', () => {
  it('removes it', () => {
    const created = createRoutine(draft())
    deleteRoutine(created.id)
    expect(getRoutine(created.id)).toBeNull()
  })

  /**
   * `routines.contact_id` is ON DELETE CASCADE, and PRAGMA foreign_keys is on
   * in create.ts — so nothing extra had to be written for this. Asserted here
   * because a routine surviving its Contact would fire against a contact that
   * no longer exists, every night, forever.
   */
  it('goes away with its Contact', () => {
    createRoutine(draft())

    db.delete(contacts).run()

    expect(listRoutines()).toHaveLength(0)
  })
})

describe('monthlyBudgetUsd', () => {
  // The exact trap updateRoutine's explicit column list warns about: a new
  // editable column left off that list saves as a silent no-op — how `model`
  // once went unsaved.
  it('saves through update, because it is editable rather than run history', () => {
    const created = createRoutine(draft())

    const saved = updateRoutine({
      id: created.id,
      contactId: CONTACT,
      schedule: '0 9 * * *',
      prompt: 'Check for new issues.',
      enabled: true,
      monthlyBudgetUsd: 12.5
    })

    expect(saved.monthlyBudgetUsd).toBe(12.5)
    expect(getRoutine(created.id)?.monthlyBudgetUsd).toBe(12.5)
  })

  it('clears back to no-budget with null', () => {
    const created = createRoutine({ ...draft(), monthlyBudgetUsd: 30 })
    expect(getRoutine(created.id)?.monthlyBudgetUsd).toBe(30)

    updateRoutine({
      id: created.id,
      contactId: CONTACT,
      schedule: '0 9 * * *',
      prompt: 'Check for new issues.',
      enabled: true,
      monthlyBudgetUsd: null
    })

    expect(getRoutine(created.id)?.monthlyBudgetUsd).toBeNull()
  })
})

describe('recordRunOutcome', () => {
  it('stamps both the time and the reason', () => {
    const created = createRoutine(draft())

    recordRunOutcome(created.id, 'Skipped — someone else is in this repo.', 1_755_000_000_000)

    const after = getRoutine(created.id)
    expect(after?.lastRunAt).toBe(1_755_000_000_000)
    expect(after?.lastRunSummary).toBe('Skipped — someone else is in this repo.')
  })

  // "Missed" means nothing happened at the scheduled time. An attempt —
  // even a lock-refused one, which is what this summary is — happened, so it
  // ends the silence the counter exists to break. Run now clears it too, by
  // the same route.
  it('clears the miss counter, because any attempt is the catch-up', () => {
    const created = createRoutine(draft())
    recordMissedRun(created.id, 1_755_000_000_000)
    recordMissedRun(created.id, 1_755_000_060_000)

    recordRunOutcome(created.id, 'Skipped — someone else is in this repo.')

    const after = getRoutine(created.id)
    expect(after?.missedRunCount).toBe(0)
    // The stamp stays: "last missed Tuesday" is still true after a catch-up,
    // and the count alone says whether anything is currently outstanding.
    expect(after?.lastMissedAt).toBe(1_755_000_060_000)
  })
})

describe('recordMissedRun', () => {
  it('accumulates the count and keeps the most recent miss', () => {
    const created = createRoutine(draft())

    recordMissedRun(created.id, 1_755_000_000_000)
    recordMissedRun(created.id, 1_755_000_060_000)

    const after = getRoutine(created.id)
    expect(after?.missedRunCount).toBe(2)
    expect(after?.lastMissedAt).toBe(1_755_000_060_000)
  })

  it('no-ops for a routine deleted between arming and missing', () => {
    expect(() => recordMissedRun('routine-gone')).not.toThrow()
  })

  // The stale-editor rule, extended to the new columns: an editor open across
  // a miss must not be able to save its snapshot back over the counter.
  it('is not writable through the draft or update shapes', () => {
    const created = createRoutine(draft())
    recordMissedRun(created.id)

    updateRoutine({
      id: created.id,
      contactId: CONTACT,
      schedule: '0 9 * * *',
      prompt: 'Edited prompt.',
      enabled: true,
      monthlyBudgetUsd: null,
      // Stale run history a snapshot might carry; the update shape strips it.
      missedRunCount: 0,
      lastMissedAt: null
    } as never)

    expect(getRoutine(created.id)?.missedRunCount).toBe(1)
  })
})
