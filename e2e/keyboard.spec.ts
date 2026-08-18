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
 * The conversation keys, driven through the real app.
 *
 * `conversation-nav.test.ts` proves the arithmetic — where a step lands, what
 * wrapping does, what happens to a selection the filter box has hidden. What no
 * unit test can say is that a key is *bound*, that it walks the order the list
 * actually renders rather than a second one computed somewhere else, and that
 * it stays out of the way of the palette. Those are the three failures worth a
 * real window.
 *
 * No turn runs here. The rows only need to exist to be walked.
 */

test.describe.configure({ mode: 'serial' })

let profile: string
let launched: LaunchedApp

/** The open conversation, read off the pane title the way a user reads it. */
function openTitle(): ReturnType<LaunchedApp['window']['getByRole']> {
  return launched.window.getByTestId('workspace').getByRole('heading', { level: 1 })
}

async function persona(name: string): Promise<string> {
  const created = await invoke<{ id: string }>(launched.window, 'personas.create', {
    name,
    avatarColor: '#2a78d6',
    backend: 'claude',
    model: 'claude-sonnet-5',
    systemPrompt: 'Say nothing.',
    skillIds: [],
    mcpServerIds: [],
    sandbox: 'read_only',
    githubScope: 'read_only'
  })
  return created.id
}

test.beforeAll(async () => {
  profile = createProfile()
  launched = await launchApp(profile)
  await launched.window.waitForFunction(() => 'api' in window)
  await invoke(launched.window, 'auth.completeOnboarding')

  /**
   * Two contacts in one repository, which is also what produces the third row:
   * `createContact` calls `ensureGroupForRepo` in its own transaction, so the
   * repo group appears without being asked for.
   *
   * Names chosen so the rendered order is known without depending on timing.
   * Neither contact has ever had a message, so `byRecency` falls through to its
   * alphabetical tail — and the list renders every contact before any group.
   * The order under test is therefore [Alpha, Beta, the group].
   */
  for (const name of ['Alpha Reader', 'Beta Writer']) {
    await invoke(launched.window, 'contacts.create', {
      personaTemplateId: await persona(name),
      repoPath: profile,
      displayName: name,
      isolation: 'shared'
    })
  }

  await launched.app.close()
  launched = await launchApp(profile)
  await waitForShell(launched.window)
  // Every launch opens on Home — `section` is deliberately not persisted.
  await launched.window.getByRole('button', { name: 'Chats', exact: true }).click()
  await launched.window.getByText('Alpha Reader').first().click()
  await expect(openTitle()).toHaveText('Alpha Reader')
})

test.afterAll(async () => {
  await launched?.app.close()
  destroyProfile(profile)
})

test('⌥↓ moves to the next conversation and ⌥↑ moves back', async () => {
  await launched.window.keyboard.press('Alt+ArrowDown')
  await expect(openTitle()).toHaveText('Beta Writer')

  await launched.window.keyboard.press('Alt+ArrowUp')
  await expect(openTitle()).toHaveText('Alpha Reader')
})

/**
 * The key walks *every* row the list renders, groups included.
 *
 * Worth its own case because contacts and groups are two sections, two queries
 * and two React branches — an implementation that walked only `visibleContacts`
 * would pass the test above and strand the user one row short of the bottom.
 */
test('⌥↓ walks past the contacts into the repo group', async () => {
  await launched.window.keyboard.press('Alt+ArrowDown')
  await launched.window.keyboard.press('Alt+ArrowDown')
  // The group's pane title is the repository's name, not a persona's.
  await expect(openTitle()).not.toHaveText('Beta Writer')
  await expect(launched.window.getByTestId('workspace').getByText('personas')).toBeVisible()
})

test('the last row wraps round to the first', async () => {
  await launched.window.keyboard.press('Alt+ArrowDown')
  await expect(openTitle()).toHaveText('Alpha Reader')
})

/**
 * The palette drives its own list with the arrow keys. Without the modal guard
 * this binding would move the conversation underneath it while the user is
 * choosing something else — invisible at the time, and confusing afterwards.
 */
test('does not move the selection while the command palette is open', async () => {
  await launched.window.keyboard.press('ControlOrMeta+KeyK')
  await expect(launched.window.getByPlaceholder(/Jump to/i)).toBeVisible()

  await launched.window.keyboard.press('Alt+ArrowDown')
  await launched.window.keyboard.press('Escape')

  await expect(openTitle()).toHaveText('Alpha Reader')
})

/**
 * ⌘L from anywhere lands in the composer without disturbing what is in it.
 *
 * The draft is typed first and asserted afterwards because that is the whole
 * reason the shortcut moves the caret rather than selecting: drafts survive
 * conversation switches (Phase 21), so a shortcut that selected the text would
 * turn the user's next keystroke into a deletion of their own half-written
 * message.
 */
test('⌘L focuses the composer and leaves the draft alone', async () => {
  const composer = launched.window.getByTestId('workspace').getByRole('textbox')
  await composer.fill('half a thought')

  // Somewhere that is definitely not the composer.
  await launched.window.getByRole('button', { name: 'Chats', exact: true }).click()
  await expect(composer).not.toBeFocused()

  await launched.window.keyboard.press('ControlOrMeta+KeyL')
  await expect(composer).toBeFocused()
  await expect(composer).toHaveValue('half a thought')

  // The caret is at the end, so typing continues the draft rather than
  // replacing it.
  await launched.window.keyboard.type('!')
  await expect(composer).toHaveValue('half a thought!')
})
