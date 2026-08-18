import { execFileSync } from 'child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
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
 * The new-contact flow's three §G4 gaps, driven through the real dialog.
 *
 * `persona-filter.test.ts` proves the ranking. What it cannot say is that the
 * filter box appears only once it is worth having, that the create-a-persona
 * detour comes back to the flow with the new persona selected, or that the name
 * typed on the confirm step is the name the contact ends up with — which is the
 * one that would silently fall back to the derived name and look almost right.
 */

test.describe.configure({ mode: 'serial' })

let profile: string
let launched: LaunchedApp
let repo: string

test.beforeAll(async () => {
  repo = mkdtempSync(join(tmpdir(), 'switchboard-newcontact-'))
  writeFileSync(join(repo, 'index.ts'), 'export const x = 1\n')
  const git = (args: string[]): void =>
    void execFileSync('git', args, { cwd: repo, stdio: 'ignore' })
  git(['init'])
  git(['-c', 'user.email=e2e@test', '-c', 'user.name=E2E', 'add', '.'])
  git(['-c', 'user.email=e2e@test', '-c', 'user.name=E2E', 'commit', '-m', 'init'])

  profile = createProfile()
  launched = await launchApp(profile)
  await launched.window.waitForFunction(() => 'api' in window)
  await invoke(launched.window, 'auth.completeOnboarding')
  await waitForShell(launched.window)
})

test.afterAll(async () => {
  await launched?.app.close()
  destroyProfile(profile)
  rmSync(repo, { recursive: true, force: true })
})

/**
 * Opens the flow.
 *
 * The list panel's + button rather than ⌘N: that accelerator belongs to the
 * Electron application menu, and `keyboard.press` talks to the renderer, so it
 * never fires here. Worth naming because the first version of this file used
 * it and the filter-absence test below *passed* — asserting a control is
 * missing succeeds beautifully when the dialog was never open.
 */
async function openFlow(): Promise<void> {
  // Start from a known state. These tests are serial and one of them
  // deliberately leaves the flow open, which puts a modal overlay over the rail
  // — clicking through it fails as a timeout rather than as anything readable.
  await launched.window.keyboard.press('Escape')
  await launched.window.getByRole('button', { name: 'Chats', exact: true }).click()
  // `.first()`: the list panel's + button and the empty state's both carry
  // this name, and a bare locator is a strict-mode violation that Playwright
  // reports as a timeout rather than as the ambiguity it is.
  await launched.window.getByRole('button', { name: 'New contact' }).first().click()
  await expect(launched.window.getByRole('button', { name: 'New persona…' })).toBeVisible()
}

/**
 * A fresh profile has the three seeded personas, so the search box must not be
 * there — a filter over three rows costs a row of a dialog already short of
 * space, to save a decision nobody has to make.
 */
test('the persona filter stays away while the list is short', async () => {
  const { window } = launched
  await openFlow()

  // The dialog is demonstrably open — `openFlow` waited for a control inside
  // it — so this absence is the filter's, not the whole dialog's.
  await expect(window.getByPlaceholder('Filter personas')).toHaveCount(0)
  await window.keyboard.press('Escape')
})

test('a persona can be created without leaving the flow, and comes back selected', async () => {
  const { window } = launched
  await openFlow()
  await window.getByRole('button', { name: 'New persona…' }).click()

  await expect(window.getByRole('heading', { name: 'New persona' })).toBeVisible()
  await window.getByLabel('Name').fill('Invoice Auditor')
  await window.getByLabel('Instructions').fill('Check the invoice totals and say what is wrong.')
  await window.getByRole('button', { name: 'Create persona' }).click()

  // Back on step one of the contact flow, with the new persona chosen — so
  // Continue is enabled without a second click on the row.
  // By role, not by text: the Home guide's checklist prints the same sentence,
  // so `getByText` matches two elements and fails as a strict-mode violation.
  await expect(window.getByRole('heading', { name: 'Pick a persona' })).toBeVisible()
  await expect(window.getByRole('button', { name: 'Continue' })).toBeEnabled()

  const personas = await invoke<{ name: string }[]>(window, 'personas.list')
  expect(personas.some((persona) => persona.name === 'Invoice Auditor')).toBe(true)
})

/**
 * The full flow, ending in a name the user typed rather than the derived one.
 *
 * The repository is bound through the local-folder route, because a throwaway
 * profile has no GitHub token. That route opens a native directory picker,
 * which Playwright cannot drive — so `dialog.showOpenDialog` is replaced inside
 * the main process for the duration. That is the smallest possible stub: every
 * other step, including the write, is the real thing.
 */
test('a contact is created with the name typed on the confirm step', async () => {
  const { window, app } = launched

  await app.evaluate(({ dialog }, chosen) => {
    dialog.showOpenDialog = () =>
      Promise.resolve({ canceled: false, filePaths: [chosen] }) as ReturnType<
        typeof dialog.showOpenDialog
      >
  }, repo)

  await openFlow()
  await window.getByRole('button', { name: 'Invoice Auditor' }).click()
  await window.getByRole('button', { name: 'Continue' }).click()

  // The visible label, not the radio: SegmentedControl puts a real radio input
  // under each segment but hides it, so the input itself is never clickable.
  await window.getByText('Local folder', { exact: true }).click()
  await window.getByRole('button', { name: 'Choose a folder' }).click()
  await window.getByRole('button', { name: 'Continue' }).click()
  await window.getByRole('button', { name: 'Continue' }).click()

  // The confirm step. The field is empty and shows the derived name as its
  // placeholder — which is what makes typing over it a deliberate act.
  const nameField = window.getByLabel('Name')
  await expect(nameField).toHaveAttribute(
    'placeholder',
    `Invoice Auditor · ${repo.split('/').pop()}`
  )
  await nameField.fill('Overnight invoice check')

  await window.getByRole('button', { name: 'Create', exact: true }).click()

  const contacts = await invoke<{ displayName: string }[]>(window, 'contacts.list')
  expect(contacts.map((contact) => contact.displayName)).toContain('Overnight invoice check')
})

/**
 * The boundary the name field made reachable. Creating a contact called nothing
 * was accepted while *renaming* one to nothing was refused — the shape was
 * unreachable only because the name used to be derived.
 */
test('a contact cannot be created with an empty name', async () => {
  const { window } = launched
  const personas = await invoke<{ id: string }[]>(window, 'personas.list')

  await expect(
    invoke(window, 'contacts.create', {
      personaTemplateId: personas[0].id,
      repoPath: repo,
      displayName: '   ',
      isolation: 'shared'
    })
  ).rejects.toThrow()
})
