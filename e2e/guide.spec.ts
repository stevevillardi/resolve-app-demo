import { join } from 'path'
import { DatabaseSync } from 'node:sqlite'
import { test, expect } from '@playwright/test'
import {
  createProfile,
  destroyProfile,
  invoke,
  launchApp,
  waitForShell,
  type LaunchedApp
} from './fixtures'

/**
 * Home's guide, driven through the real app.
 *
 * `guide.test.ts` proves the content model — which steps are done, which
 * sections get explained, which keys are printed. None of that says the rows
 * are wired to anything, and a guide whose click-throughs are decorative is
 * worse than no guide: it teaches an action and then does not perform it.
 *
 * Two shapes to cover, and they are genuinely different screens: the whole
 * pane on a profile with nothing to summarise, and the collapsible strip under
 * a Home that has content. The strip's fold is persisted, so the reload is the
 * assertion — a preference that resets on relaunch is not a preference.
 */

test.describe.configure({ mode: 'serial' })

let profile: string
let launched: LaunchedApp

test.beforeAll(async () => {
  profile = createProfile()
  launched = await launchApp(profile)
  await launched.window.waitForFunction(() => 'api' in window)
  // Past onboarding, but with no contacts: the fresh-install shape.
  await invoke(launched.window, 'auth.completeOnboarding')
  await launched.app.close()

  launched = await launchApp(profile)
  await waitForShell(launched.window)
})

test.afterAll(async () => {
  await launched?.app.close().catch(() => {})
  destroyProfile(profile)
})

test.describe('the guide on an empty profile', () => {
  test('greets a fresh install with the app explained, not an apology', async () => {
    const { window } = launched
    // Scoped to the workspace: the splash carries an `h1` reading "Switchboard"
    // too, and it is still fading for the first second after `waitForShell`.
    await expect(
      window.getByRole('main').getByRole('heading', { name: 'Switchboard', exact: true })
    ).toBeVisible()
    await expect(window.getByRole('heading', { name: 'First steps' })).toBeVisible()
    await expect(window.getByRole('heading', { name: 'What is where' })).toBeVisible()
  })

  test('shows every step outstanding, and none of them ticked', async () => {
    const { window } = launched
    for (const step of [
      'Make a contact',
      'Say something to it',
      'Connect GitHub',
      'Put work on a schedule'
    ]) {
      await expect(window.getByText(step, { exact: true })).toBeVisible()
    }
  })

  test('prints the keys the app actually binds', async () => {
    const { window } = launched
    // ⌘ because the sweep and this suite run on macOS; the platform rewrite
    // itself is covered in guide.test.ts, where both branches can be reached.
    for (const key of ['⌘K', '⌘N', '⌘B', '⌘,', '/']) {
      await expect(window.getByText(key, { exact: true }).first()).toBeVisible()
    }
  })

  // The whole point of the screen: every row goes somewhere.
  test('the first step opens the new-contact dialog', async () => {
    const { window } = launched
    await window.getByText('Make a contact', { exact: true }).click()
    await expect(window.getByRole('heading', { name: 'Pick a persona' })).toBeVisible()
    await window.keyboard.press('Escape')
    await expect(window.getByRole('heading', { name: 'Pick a persona' })).toBeHidden()
  })

  test('a section row navigates the rail', async () => {
    const { window } = launched
    await window
      .getByText('Reusable instruction text any persona can attach.', {
        exact: false
      })
      .click()

    // Skills has a list panel; Home does not, which is the visible difference.
    await expect(window.getByRole('button', { name: 'New skill' })).toBeVisible()

    await window.getByRole('button', { name: 'Home', exact: true }).click()
    await expect(window.getByRole('heading', { name: 'First steps' })).toBeVisible()
  })
})

/** The id of the contact made below, so the next block can post a message to it. */
let contactId: string

test.describe('once a step is done', () => {
  test.beforeAll(async () => {
    const persona = await invoke<{ id: string }>(launched.window, 'personas.create', {
      name: 'Guide Reader',
      avatarColor: '#2a78d6',
      backend: 'claude',
      model: null,
      systemPrompt: 'Read the guide.',
      skillIds: [],
      mcpServerIds: [],
      sandbox: 'read_only',
      githubScope: 'read_only'
    })
    const contact = await invoke<{ id: string }>(launched.window, 'contacts.create', {
      personaTemplateId: persona.id,
      repoPath: profile,
      displayName: 'Guide Reader',
      isolation: 'shared'
    })
    contactId = contact.id
    await launched.window.reload()
    await waitForShell(launched.window)
  })

  /**
   * A contact alone is not content: Home with contacts but nothing said is
   * still the full-pane shape, deliberately — there is nothing to summarise, so
   * the guide is still the most useful thing in the pane.
   */
  test('keeps the whole guide, and ticks the step off live state', async () => {
    const { window } = launched
    await expect(window.getByRole('heading', { name: 'First steps' })).toBeVisible()
    // Nothing remembered a click: the count is read off the contact that exists.
    await expect(window.getByText('1 of 4 done.', { exact: false })).toBeVisible()
  })
})

test.describe('the guide once Home has content', () => {
  /**
   * The message row goes in through SQLite rather than by sending one, for the
   * reason no spec in this suite starts a turn: a real turn costs money and
   * needs credentials the throwaway profile does not have. One turn is all it
   * takes — a "Recent" row is a summary, and a summary is what displaces the
   * full guide.
   */
  test.beforeAll(async () => {
    await launched.app.close()
    const db = new DatabaseSync(join(profile, 'userData', 'switchboard.db'))
    try {
      db.prepare(
        'insert into messages (id, contact_id, role, content, timestamp) values (?, ?, ?, ?, ?)'
      ).run('guide-m1', contactId, 'assistant', 'Read the guide, then.', Date.now())
    } finally {
      db.close()
    }

    launched = await launchApp(profile)
    await waitForShell(launched.window)
  })

  test('gives way to the summary, and keeps the tour as a strip', async () => {
    const { window } = launched
    await expect(window.getByRole('heading', { name: 'Recent' })).toBeVisible()
    // The masthead and the checklist belong to the empty screen only.
    await expect(window.getByRole('heading', { name: 'First steps' })).toBeHidden()
    await expect(window.getByRole('heading', { name: 'What is where' })).toBeVisible()
  })

  test('folds away and stays folded across a relaunch', async () => {
    const { window } = launched
    const hide = window.getByRole('button', { name: 'Hide the guide' })
    await expect(hide).toBeVisible()
    // Open by default, so the rows are on screen before anything is clicked.
    await expect(window.getByText('Message one contact', { exact: false })).toBeVisible()

    await hide.click()
    await expect(window.getByText('Message one contact', { exact: false })).toBeHidden()
    // Collapsed is one heading and a chevron — which is also the only way back,
    // so folding the guide away can never lose it.
    const show = window.getByRole('button', { name: 'Show the guide' })
    await expect(show).toBeVisible()

    await window.reload()
    await waitForShell(window)
    await expect(window.getByRole('button', { name: 'Show the guide' })).toBeVisible()
    await expect(window.getByText('Message one contact', { exact: false })).toBeHidden()

    await window.getByRole('button', { name: 'Show the guide' }).click()
    await expect(window.getByText('Message one contact', { exact: false })).toBeVisible()
  })
})
