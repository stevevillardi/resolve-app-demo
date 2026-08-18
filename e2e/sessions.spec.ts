import { test, expect } from '@playwright/test'
import {
  createProfile,
  destroyProfile,
  invoke,
  launchApp,
  readProfileDb,
  waitForShell,
  writeProfileDb,
  type LaunchedApp
} from './fixtures'

/**
 * Phase 22's controls, driven through the real app.
 *
 * The unit suite proves the rules: which session answered a message, when a
 * divider is drawn, what a fraction is of. None of that says a menu item is
 * wired to any of it, and this phase is almost entirely about making an
 * existing capability *reachable* — clearBackendSessionId had one caller and no
 * IPC, and isolation was mutable in the database and refused everywhere above
 * it. A control that teaches an action and then does not perform it is the
 * failure worth testing for.
 *
 * No turn is ever started here: a real turn costs money and needs credentials a
 * throwaway profile does not have. Sessions and usage rows are staged through
 * the profile database while the app is closed, the way `guide.spec.ts` and
 * `conversation-loop.spec.ts` stage theirs.
 */

test.describe.configure({ mode: 'serial' })

let profile: string
let launched: LaunchedApp
let contactId: string

const SESSION = 'session-staged-1'
const EARLIER = 'session-staged-0'

test.beforeAll(async () => {
  profile = createProfile()
  launched = await launchApp(profile)
  await launched.window.waitForFunction(() => 'api' in window)
  await invoke(launched.window, 'auth.completeOnboarding')

  const persona = await invoke<{ id: string }>(launched.window, 'personas.create', {
    name: 'Session Reader',
    avatarColor: '#2a78d6',
    backend: 'claude',
    model: 'claude-sonnet-5',
    systemPrompt: 'Read the session.',
    skillIds: [],
    mcpServerIds: [],
    sandbox: 'read_only',
    githubScope: 'read_only'
  })
  const contact = await invoke<{ id: string }>(launched.window, 'contacts.create', {
    personaTemplateId: persona.id,
    repoPath: profile,
    displayName: 'Session Reader',
    isolation: 'shared'
  })
  contactId = contact.id

  await launched.app.close()

  // A thread that spans two sessions, and a usage row for the live one — the
  // state a few real turns would leave, minus the turns.
  const now = Date.now()
  writeProfileDb(
    profile,
    `insert into messages (id, contact_id, role, content, timestamp, session_id)
     values (?, ?, 'user', 'what changed overnight?', ?, ?)`,
    'm1',
    contactId,
    now - 60_000,
    EARLIER
  )
  writeProfileDb(
    profile,
    `insert into messages (id, contact_id, role, content, timestamp, session_id)
     values (?, ?, 'assistant', 'Nothing landed on main.', ?, ?)`,
    'm2',
    contactId,
    now - 50_000,
    EARLIER
  )
  writeProfileDb(
    profile,
    `insert into messages (id, contact_id, role, content, timestamp, session_id)
     values (?, ?, 'user', 'and since then?', ?, ?)`,
    'm3',
    contactId,
    now - 40_000,
    SESSION
  )
  writeProfileDb(
    profile,
    `update contacts set backend_session_id = ? where id = ?`,
    SESSION,
    contactId
  )
  writeProfileDb(
    profile,
    `insert into usage_events
       (id, contact_id, timestamp, source, input_tokens, output_tokens, cost_usd, model, session_id)
     values (?, ?, ?, 'message', 50000, 400, 0.12, 'claude-sonnet-5', ?)`,
    'u1',
    contactId,
    now - 40_000,
    SESSION
  )

  launched = await launchApp(profile)
  await waitForShell(launched.window)
  // Every launch opens on Home — `section` is deliberately not persisted — so
  // the thread has to be navigated to rather than assumed.
  await launched.window.getByRole('button', { name: 'Chats', exact: true }).click()
  await launched.window.getByText('Session Reader').first().click()
  await expect(thread().getByText('and since then?')).toBeVisible()
})

/**
 * The thread pane. Scoped because the conversation list shows the last message
 * as a preview, so every assertion on message text matches twice otherwise —
 * and the preview would pass while the thread rendered nothing.
 */
function thread(): ReturnType<LaunchedApp['window']['getByTestId']> {
  return launched.window.getByTestId('workspace')
}

test.afterAll(async () => {
  await launched?.app.close().catch(() => {})
  destroyProfile(profile)
})

test.describe('the session boundary', () => {
  test('draws the divider where the session changed', async () => {
    await expect(thread().getByText('New session — nothing above is in memory')).toBeVisible()
  })

  test('shows how full the session is, marked approximate', async () => {
    // 50k of a 200k window. The ≈ is the claim being checked: a turn reports
    // one figure covering every request it made, so this reads high.
    await expect(thread().getByText('≈25%')).toBeVisible()
  })
})

test.describe('starting a fresh session', () => {
  test('clears the resume key and keeps every message', async () => {
    const { window } = launched
    await window.getByRole('button', { name: 'Manage Session Reader' }).click()
    await window.getByRole('menuitem', { name: 'Start a fresh session…' }).click()
    await expect(window.getByRole('heading', { name: 'Start a fresh session?' })).toBeVisible()
    await window.getByRole('button', { name: 'Start fresh' }).click()

    // The point of the feature: the conversation is untouched.
    await expect(thread().getByText('Nothing landed on main.')).toBeVisible()
    await expect(thread().getByText('and since then?')).toBeVisible()
    // And the durable trace is the cleared key, which the thread reads back.
    await expect(thread().getByText('The next message starts a new session')).toBeVisible()

    const [row] = readProfileDb<{ backend_session_id: string | null }>(
      profile,
      `select backend_session_id from contacts where id = ?`,
      contactId
    )
    expect(row.backend_session_id).toBeNull()
  })

  test('takes the meter with it — there is no live session to measure', async () => {
    await expect(thread().getByText('≈25%')).toBeHidden()
  })
})

test.describe('changing where a contact works', () => {
  test('moves it into its own checkout, and the row follows', async () => {
    const { window } = launched
    await window.getByRole('button', { name: 'Manage Session Reader' }).click()
    await window.getByRole('menuitem', { name: 'Change where it works…' }).click()
    await expect(window.getByRole('heading', { name: /Where Session Reader works/ })).toBeVisible()

    await window.getByText('Its own checkout').click()
    await window.getByRole('button', { name: 'Move it' }).click()

    // Nothing is created on disk here — the next writing turn does that — so
    // the row is the whole assertion.
    await expect
      .poll(() => {
        const [row] = readProfileDb<{ isolation: string; worktree_path: string | null }>(
          profile,
          `select isolation, worktree_path from contacts where id = ?`,
          contactId
        )
        return row.isolation
      })
      .toBe('worktree')

    const [row] = readProfileDb<{ worktree_path: string | null; branch: string | null }>(
      profile,
      `select worktree_path, branch from contacts where id = ?`,
      contactId
    )
    expect(row.worktree_path).toContain('worktrees')
    expect(row.branch).toMatch(/^persona\//)
  })
})

test.describe('a model for one contact', () => {
  test('overrides the persona without touching it', async () => {
    const { window } = launched
    await window.getByRole('button', { name: 'Manage Session Reader' }).click()
    await window.getByRole('menuitem', { name: 'Use a different model…' }).click()
    await expect(window.getByRole('heading', { name: /Model for Session Reader/ })).toBeVisible()

    await window.getByText('claude-opus-5', { exact: true }).click()
    await window.getByRole('button', { name: 'Use it' }).click()

    await expect
      .poll(() => {
        const [row] = readProfileDb<{ model: string | null }>(
          profile,
          `select model from contacts where id = ?`,
          contactId
        )
        return row.model
      })
      .toBe('claude-opus-5')

    // The persona it is bound to is deliberately unchanged — that is the whole
    // reason this column exists.
    // By name: the starter library seeds its own personas, so `limit 1` would
    // have read one of those and passed for the wrong reason.
    const [persona] = readProfileDb<{ model: string | null }>(
      profile,
      `select model from persona_templates where name = 'Session Reader'`
    )
    expect(persona.model).toBe('claude-sonnet-5')
  })
})
