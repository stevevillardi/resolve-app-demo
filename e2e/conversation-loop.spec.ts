import { execFileSync } from 'child_process'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { expect, test } from '@playwright/test'
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
 * Phase 21's conversation loop, end to end. No spec in this suite starts a
 * real turn (money), so the states a *failed or killed* turn leaves behind
 * are staged with writeProfileDb while the app is closed — which is also the
 * honest shape of the claim: crash reconciliation and the unanswered-tail
 * notice exist precisely for state no live process is tending.
 *
 * The retry *pipeline* is unit-covered in messaging.test.ts; here the Retry
 * affordance is asserted to render, not clicked — clicking would spawn a
 * real SDK against empty credentials.
 *
 * Lock-refusal draft preservation is not drivable here either (a refusal
 * needs a live blocking run): the mechanic is pinned by the composer's
 * clear-on-success structure plus messaging.test.ts's refusal cases.
 */

test.describe.configure({ mode: 'serial', timeout: 180_000 })

let profile: string
let launched: LaunchedApp
let readerId: string

test.beforeAll(async () => {
  profile = createProfile()

  // A real (uncommitted) git repo for @file completion: ls-files sees
  // untracked-but-not-ignored files, so no commit is needed.
  const repo = join(profile, 'repo')
  mkdirSync(repo)
  execFileSync('git', ['init', '-q', '-b', 'main', repo])
  writeFileSync(join(repo, 'auth.ts'), 'export {}\n')
  writeFileSync(join(repo, 'engine.ts'), 'export {}\n')
  const other = join(profile, 'other')
  mkdirSync(other)

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

  const reader = await invoke<{ id: string }>(launched.window, 'contacts.create', {
    personaTemplateId: persona.id,
    repoPath: repo,
    displayName: 'Reader'
  })
  readerId = reader.id

  // Its own persona: the sidebar and the composer placeholder show the
  // *persona* name, so a second contact on the same persona would be
  // indistinguishable from the first everywhere the tests look.
  const writerPersona = await invoke<{ id: string }>(launched.window, 'personas.create', {
    name: 'Writer',
    avatarColor: '#b04e72',
    backend: 'claude',
    model: null,
    systemPrompt: 'Write carefully.',
    skillIds: [],
    mcpServerIds: [],
    sandbox: 'read_only',
    githubScope: 'read_only'
  })
  await invoke(launched.window, 'contacts.create', {
    personaTemplateId: writerPersona.id,
    repoPath: other,
    displayName: 'Writer'
  })

  await invoke(launched.window, 'auth.completeOnboarding')
  await launched.window.reload()
  await waitForShell(launched.window)
})

test.afterAll(async () => {
  await launched?.app.close()
  destroyProfile(profile)
})

test('a draft survives switching away and back', async () => {
  const { window } = launched
  await window.getByRole('button', { name: 'Chats' }).first().click()
  await window.getByTestId('list-row').filter({ hasText: 'Reader' }).first().click()

  const composer = window.getByPlaceholder('Message Reader…')
  await composer.pressSequentially('half a thought about the token cache')

  await window.getByTestId('list-row').filter({ hasText: 'Writer' }).first().click()
  await expect(window.getByPlaceholder('Message Writer…')).toHaveValue('')

  await window.getByTestId('list-row').filter({ hasText: 'Reader' }).first().click()
  await expect(window.getByPlaceholder('Message Reader…')).toHaveValue(
    'half a thought about the token cache'
  )
  // Leave the composer clean for the tests that follow.
  await window.getByPlaceholder('Message Reader…').fill('')
})

test('typing @ offers the working tree and inserts the bare path', async () => {
  const { window } = launched
  const composer = window.getByPlaceholder('Message Reader…')
  await composer.pressSequentially('look at @au')

  const option = window.getByRole('option', { name: 'auth.ts' })
  await expect(option).toBeVisible()
  await option.click()

  await expect(composer).toHaveValue('look at auth.ts ')
  await composer.fill('')
})

test('a crash leaves orphans; the next boot reconciles them', async () => {
  // Stage what a killed process leaves behind: a question with no reply, a
  // tool call still claiming to run, and some history worth searching.
  await launched.app.close()

  const now = Date.now()
  writeProfileDb(
    profile,
    `insert into messages (id, contact_id, role, content, timestamp, work)
     values ('e2e-m1', ?, 'assistant', 'The flux capacitor lives in engine.ts.', ?, null)`,
    readerId,
    now - 60_000
  )
  writeProfileDb(
    profile,
    `insert into messages (id, contact_id, role, content, timestamp, work)
     values ('e2e-m2', ?, 'user', 'now check the plutonium chamber', ?, null)`,
    readerId,
    now - 30_000
  )
  writeProfileDb(
    profile,
    `insert into tool_calls (id, contact_id, message_id, tool_call_id, name, status, created_at, detail, output)
     values ('e2e-t1', ?, null, 'call-1', 'Bash', 'running', ?, 'sleep 999', null)`,
    readerId,
    now - 45_000
  )

  launched = await launchApp(profile)
  await waitForShell(launched.window)

  // The boot sweep ran before IPC came up: the orphan is failed, its record
  // untouched.
  const [call] = readProfileDb<{ status: string; detail: string }>(
    profile,
    "select status, detail from tool_calls where id = 'e2e-t1'"
  )
  expect(call.status).toBe('failed')
  expect(call.detail).toBe('sleep 999')
})

test('an unanswered tail renders the interrupted notice with a retry', async () => {
  const { window } = launched
  await window.getByRole('button', { name: 'Chats' }).first().click()
  await window.getByTestId('list-row').filter({ hasText: 'Reader' }).first().click()

  await expect(window.getByText('This turn was interrupted before it finished.')).toBeVisible()
  // Rendered, not clicked: a real retry would spawn a real SDK.
  await expect(window.getByRole('button', { name: 'Retry' })).toBeVisible()
})

test('⌘K finds message content and lands in its thread', async () => {
  const { window } = launched
  // Somewhere that is not the thread, so landing in it is observable.
  await window.getByRole('button', { name: 'Home' }).first().click()

  await window.keyboard.press(process.platform === 'darwin' ? 'Meta+KeyK' : 'Control+KeyK')
  await window.getByPlaceholder('Jump to or start anything…').fill('flux capacitor')

  const hit = window.getByRole('option').filter({ hasText: 'flux' }).first()
  await expect(hit).toBeVisible()
  await hit.click()

  // The palette closed into the conversation the message lives in.
  await expect(window.getByPlaceholder('Message Reader…')).toBeVisible()
  await expect(window.getByText('The flux capacitor lives in engine.ts.')).toBeVisible()
})
