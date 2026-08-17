import { expect, test } from '@playwright/test'
import {
  createProfile,
  destroyProfile,
  invoke,
  launchApp,
  readProfileDb,
  waitForShell,
  type LaunchedApp
} from './fixtures'

/**
 * Phase 20's durable state, observed the way routines.spec.ts observes
 * residency: by reading the profile's SQLite. The unread *rendering* (badge,
 * divider) is covered by the screens sweep and verified live; what belongs
 * here is that the boundary actually moves when a thread is opened, through
 * the real UI, the real IPC layer, and the real migrations — and that a
 * budget survives the same round trip.
 *
 * No spec in this suite starts a turn (money), so unread *counts* are covered
 * by unit tests against the same SQL; the boundary movement is the part only
 * a running app can prove.
 */

test.describe.configure({ timeout: 180_000 })

let profile: string
let launched: LaunchedApp
let contactId: string

test.beforeAll(async () => {
  profile = createProfile()
  launched = await launchApp(profile)
  await launched.window.waitForFunction(() => 'api' in window)

  const persona = await invoke<{ id: string }>(launched.window, 'personas.create', {
    name: 'Reader',
    avatarColor: '#2a78d6',
    backend: 'claude',
    model: null,
    systemPrompt: 'Read carefully.',
    skillIds: [],
    mcpServerIds: [],
    sandbox: 'read_only',
    githubScope: 'read_only'
  })

  const contact = await invoke<{ id: string }>(launched.window, 'contacts.create', {
    personaTemplateId: persona.id,
    repoPath: profile,
    displayName: 'Reader'
  })
  contactId = contact.id

  // The sidebar the first test clicks does not exist until onboarding is
  // behind us — same sequence the other UI-driving specs use.
  await invoke(launched.window, 'auth.completeOnboarding')
  await launched.window.reload()
  await waitForShell(launched.window)
})

test.afterAll(async () => {
  await launched?.app.close()
  destroyProfile(profile)
})

test('a contact is born read, and opening its thread advances the boundary', async () => {
  const [before] = readProfileDb<{ last_read_at: number | null }>(
    profile,
    'select last_read_at from contacts where id = ?',
    contactId
  )
  // Born read: creation stamped the boundary, so a fresh install shows no
  // badges — the same guarantee migration 0016's backfill gives upgrades.
  expect(before.last_read_at).not.toBeNull()

  // Open the thread through the real sidebar, like a user would. The app
  // rests on Home, so the conversation list needs the Chats section first.
  await launched.window.getByRole('button', { name: 'Chats' }).first().click()
  await launched.window.getByTestId('list-row').filter({ hasText: 'Reader' }).first().click()

  // The mark-read effect fires on mount; the boundary must move forward.
  await expect
    .poll(() => {
      const [row] = readProfileDb<{ last_read_at: number | null }>(
        profile,
        'select last_read_at from contacts where id = ?',
        contactId
      )
      return row.last_read_at
    })
    .toBeGreaterThan(before.last_read_at as number)
})

test('a routine budget round-trips through IPC and the migrations', async () => {
  const routine = await invoke<{ id: string }>(launched.window, 'routines.create', {
    contactId,
    schedule: '0 9 * * *',
    prompt: 'Sweep.',
    enabled: false,
    monthlyBudgetUsd: 12.5
  })

  const [saved] = readProfileDb<{ monthly_budget_usd: number | null }>(
    profile,
    'select monthly_budget_usd from routines where id = ?',
    routine.id
  )
  expect(saved.monthly_budget_usd).toBe(12.5)

  // Clearing goes back to null — no budget — not zero.
  await invoke(launched.window, 'routines.update', {
    id: routine.id,
    contactId,
    schedule: '0 9 * * *',
    prompt: 'Sweep.',
    enabled: false,
    monthlyBudgetUsd: null
  })

  const [cleared] = readProfileDb<{ monthly_budget_usd: number | null }>(
    profile,
    'select monthly_budget_usd from routines where id = ?',
    routine.id
  )
  expect(cleared.monthly_budget_usd).toBeNull()
})
