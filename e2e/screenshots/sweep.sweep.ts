import { rmSync } from 'fs'
import { join } from 'path'
import { test, expect, type Page, type ElectronApplication } from '@playwright/test'
import { createProfile, destroyProfile, invoke, launchApp, waitForShell } from '../fixtures'
import { seedShowcase } from './showcase'

/**
 * Photographs every screen in the app, in both themes, at two window sizes.
 *
 * This is a review instrument, not a test. It asserts only that the shell and
 * the pane under the lens are on screen — enough that a crash or a blank pane
 * fails loudly — and then writes a PNG. The actual finding is done by a human
 * comparing two directories, which is why it lives in its own Playwright
 * project and never runs as part of `npm run test:e2e`.
 *
 *     npm run screens
 *
 * Deliberately **no `toHaveScreenshot()`**. Relative timestamps, the live
 * clock and macOS font rendering make pixel baselines permanently red, and a
 * permanently-red check is one nobody reads. The comparison is
 * `test-results/screens/` before a change against the same directory after.
 *
 * Two profiles, one launch each, because a cold Electron start plus migrations
 * is the expensive part and "empty" is a property of the database rather than
 * of the UI — you cannot deselect your way back to a fresh install.
 */

const OUT = join('test-results', 'screens')

/** Below ~1100 the 300px list panel and the workspace's minSize={420} start
 *  fighting, which is exactly the width worth looking at. */
const SIZES = { narrow: [1100, 760], wide: [1600, 1000] } as const

const SECTIONS = ['Chats', 'Branches', 'Personas', 'Skills', 'Routines', 'Usage'] as const

test.describe.configure({ timeout: 300_000, mode: 'serial' })

async function resize(app: ElectronApplication, width: number, height: number): Promise<void> {
  // page.setViewportSize is ignored by Electron — the window is the viewport.
  await app.evaluate(
    ({ BrowserWindow }, size) => {
      const win = BrowserWindow.getAllWindows()[0]
      win?.setContentSize(size.width, size.height)
    },
    { width, height }
  )
  await new Promise((resolve) => setTimeout(resolve, 250))
}

/**
 * Drives the real theme menu rather than toggling the class directly, so the
 * menu itself gets photographed and the persisted-preference path is the one
 * under review.
 */
async function setTheme(page: Page, theme: 'Light' | 'Dark'): Promise<void> {
  await page.getByRole('button', { name: /^Theme/ }).click()
  await page.getByRole('menuitemradio', { name: theme }).click()
  await page.keyboard.press('Escape')
  await expect
    .poll(() => page.evaluate(() => document.documentElement.classList.contains('dark')))
    .toBe(theme === 'Dark')
}

async function shoot(page: Page, name: string): Promise<void> {
  await expect(page.locator('[data-slot="sidebar"]')).toBeVisible()
  await page.screenshot({ path: join(OUT, `${name}.png`) })
}

/**
 * The nav rail's buttons carry `aria-label={item.label}` (NavRail.tsx), so they
 * are addressable by name even collapsed — the `waitForShell` note about labels
 * being display:none predates that attribute.
 */
async function goTo(page: Page, section: string): Promise<void> {
  await page.getByRole('button', { name: section, exact: true }).click()
  await new Promise((resolve) => setTimeout(resolve, 200))
}

/**
 * Selects the first row of the open section, and reports whether there was one.
 *
 * The empty-state check is the whole point, and it is a trap this sweep has
 * fallen into twice: an empty list still has a button in its body, because the
 * empty state's call to action lives there. Clicking it opens the new-contact
 * dialog, whose backdrop then swallows every subsequent click — and the failure
 * surfaces several steps later, as a timeout on something unrelated.
 */
async function selectFirstRow(page: Page): Promise<boolean> {
  const empty = await page.locator('[data-slot="list-body"] [data-slot="empty-state"]').count()
  if (empty > 0) return false

  const rows = page.locator('[data-slot="list-body"] button')
  if ((await rows.count()) === 0) return false

  await rows.first().click()
  await new Promise((resolve) => setTimeout(resolve, 350))
  return true
}

async function sweep(page: Page, app: ElectronApplication, profileName: string): Promise<void> {
  for (const theme of ['Light', 'Dark'] as const) {
    await setTheme(page, theme)
    for (const [sizeName, [width, height]] of Object.entries(SIZES)) {
      await resize(app, width, height)

      // Selection is deliberately not persisted (useUiStore's `partialize`), so
      // a reload is the honest way back to "nothing selected" — and without it
      // every `-list` shot after the first iteration would still be showing the
      // row the previous iteration clicked, which is the one state these shots
      // exist to capture.
      await page.reload()
      await waitForShell(page)
      // Long enough for the launch splash to finish fading. App.tsx holds it
      // for a 650ms minimum and then transitions out; shooting earlier catches
      // the wordmark ghosted over the workspace pane.
      await new Promise((resolve) => setTimeout(resolve, 1400))

      const stem = `${profileName}-${theme.toLowerCase()}-${sizeName}`

      // Home is shot on its own rather than inside the loop below: it is the
      // one section with no list panel at all, so there is no first row to
      // select and `selectFirstRow` would be looking for a `list-body` that
      // does not exist.
      await goTo(page, 'Home')
      await shoot(page, `${stem}-home`)

      // The guide sits under everything Home has to report, so on a profile
      // with content it is always below the fold — and a region no shot reaches
      // is a region that rots. Absent on a fresh install, where the guide *is*
      // the whole pane and the shot above already has it.
      const guideToggle = page.getByRole('button', { name: /^(Hide|Show) the guide$/ })
      if (await guideToggle.isVisible().catch(() => false)) {
        await guideToggle.scrollIntoViewIfNeeded()
        await new Promise((resolve) => setTimeout(resolve, 250))
        await shoot(page, `${stem}-home-guide`)
      }

      for (const section of SECTIONS) {
        await goTo(page, section)
        await shoot(page, `${stem}-${section.toLowerCase()}-list`)

        // Then the same section with its first row selected. Usage always has a
        // row ("All personas"); the others may legitimately have none.
        if (await selectFirstRow(page)) {
          await shoot(page, `${stem}-${section.toLowerCase()}-selected`)
        }
      }

      // Surfaces that are not a section.
      await goTo(page, 'Chats')
      await page.keyboard.press('Meta+k')
      await expect(page.getByPlaceholder(/search|type a command/i).first()).toBeVisible()
      await shoot(page, `${stem}-command-palette`)
      await page.keyboard.press('Escape')

      await page.getByRole('button', { name: 'New contact' }).first().click()
      await new Promise((resolve) => setTimeout(resolve, 300))
      await shoot(page, `${stem}-new-contact`)
      await page.keyboard.press('Escape')

      // The contact menu and the context panel, both reached from a thread.
      await goTo(page, 'Chats')
      if (await selectFirstRow(page)) {
        const menu = page.getByRole('button', { name: /^Manage / })
        if (await menu.isVisible().catch(() => false)) {
          await menu.click()
          await new Promise((resolve) => setTimeout(resolve, 250))
          await shoot(page, `${stem}-contact-menu`)
          await page.getByRole('menuitem', { name: /works with/ }).click()
          await new Promise((resolve) => setTimeout(resolve, 600))
          await shoot(page, `${stem}-context-panel`)
          await page.keyboard.press('Escape')
          await new Promise((resolve) => setTimeout(resolve, 250))
        }
      }

      // The destructive confirm, reached through the skill editor because it is
      // the one section that always has rows (five ship as seed data) and its
      // delete needs no worktree. It is the surface most in need of looking at
      // and the sweep was missing it entirely.
      await goTo(page, 'Skills')
      if (await selectFirstRow(page)) {
        const remove = page.getByRole('button', { name: 'Delete skill' })
        if (await remove.isVisible().catch(() => false)) {
          await remove.click()
          await new Promise((resolve) => setTimeout(resolve, 300))
          await shoot(page, `${stem}-confirm-delete`)
          await page.keyboard.press('Escape')
        }
      }
    }
  }
}

test('seeded — every section with content', async () => {
  rmSync(OUT, { recursive: true, force: true })
  const profile = createProfile()
  let launched = await launchApp(profile)
  const showcase = await seedShowcase(launched, profile)

  launched = await launchApp(profile)
  await waitForShell(launched.window)
  try {
    await sweep(launched.window, launched.app, 'seeded')
  } finally {
    await launched.app.close()
    destroyProfile(profile)
    rmSync(showcase.scratch, { recursive: true, force: true })
  }
})

test('empty — a fresh install, and a search that matches nothing', async () => {
  const profile = createProfile()
  let launched = await launchApp(profile)
  await launched.window.waitForFunction(() => 'api' in window)
  await invoke(launched.window, 'auth.completeOnboarding')
  await launched.app.close()

  launched = await launchApp(profile)
  await waitForShell(launched.window)
  try {
    await sweep(launched.window, launched.app, 'empty')

    // A search matching nothing is a different state from an empty database:
    // the list is empty but the answer is "narrow it differently", not "make
    // one". Both need to say the right thing.
    await resize(launched.app, 1600, 1000)
    await setTheme(launched.window, 'Dark')
    for (const section of ['Chats', 'Personas', 'Skills', 'Routines', 'Branches']) {
      await goTo(launched.window, section)
      const search = launched.window.getByRole('searchbox').first()
      if (await search.isVisible().catch(() => false)) {
        await search.fill('zzzznothingmatchesthis')
        await new Promise((resolve) => setTimeout(resolve, 250))
        await shoot(launched.window, `nomatch-${section.toLowerCase()}`)
        await search.fill('')
      }
    }
  } finally {
    await launched.app.close()
    destroyProfile(profile)
  }
})
