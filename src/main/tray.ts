import { app, Menu, nativeImage, Tray } from 'electron'
import { existsSync, readFileSync } from 'fs'
import trayIcon1x from '../../resources/trayTemplate.png?asset'
import trayIcon2x from '../../resources/trayTemplate@2x.png?asset'
import { listActiveRuns } from './services/messaging'
import { nextRuns } from './services/scheduler'
import { buildTrayMenu, type TrayMenuItem } from './tray-menu'

/**
 * The menu-bar presence that makes routines worth having (blueprint §15E).
 *
 * Without it the app is resident but unreachable once the window is closed:
 * macOS already keeps the process alive, so this is not what *enables*
 * background running — it is what makes it visible and quittable.
 *
 * Held in a module-level variable rather than a local, because a `Tray` that
 * goes out of scope is garbage-collected and its icon silently disappears from
 * the menu bar minutes later.
 */
let tray: Tray | null = null
let showWindow: (() => void) | null = null

export function createTray(onShow: () => void): void {
  if (tray) return

  const image = trayImage()
  if (!image) {
    // Better a missing menu-bar icon than a failed launch: everything else in
    // the app still works, and the scheduler does not depend on this at all.
    console.error('[tray] no usable tray icon; skipping the menu-bar item')
    return
  }

  showWindow = onShow
  tray = new Tray(image)
  tray.setToolTip('Switchboard')
  refreshTrayMenu()
}

/**
 * Rebuilds the menu from current state.
 *
 * `Menu.buildFromTemplate` is a snapshot, so `setContextMenu` has to be called
 * again for anything to change. Three things trigger it — a schedule changing,
 * a routine finishing, and the set of in-flight turns changing (registered in
 * index.ts via onRunsChangedInMain) — which between them cover everything the
 * menu displays. Times are absolute (see tray-menu.ts), so there is no clock
 * to keep up with.
 */
export function refreshTrayMenu(): void {
  if (!tray) return

  const runningTurns = listActiveRuns().length
  tray.setContextMenu(
    Menu.buildFromTemplate(buildTrayMenu(nextRuns(), { runningTurns }).map(toMenuItem))
  )
  // The count beside the icon, macOS only — the one glanceable "agents are
  // working" signal that survives the window being hidden. Cleared, not '0':
  // a zero in the menu bar reads as a badge stuck on nothing.
  if (process.platform === 'darwin') {
    tray.setTitle(runningTurns > 0 ? String(runningTurns) : '')
  }
}

/**
 * Whether there is a menu-bar item to get back in through.
 *
 * The window's close handler asks before hiding instead of closing: with no
 * tray, hiding would leave the app running with no window, no icon, and no way
 * to quit it short of Activity Monitor.
 */
export function hasTray(): boolean {
  return tray !== null
}

export function destroyTray(): void {
  tray?.destroy()
  tray = null
  showWindow = null
}

function toMenuItem(item: TrayMenuItem): Electron.MenuItemConstructorOptions {
  if (item.id === 'separator') return { type: 'separator' }
  if (item.id === 'header') return { label: item.label, enabled: false }
  if (item.id === 'show') return { label: item.label, click: () => showWindow?.() }
  // "N turns running" is an invitation to look, so clicking it is Show.
  if (item.id === 'running') return { label: item.label, click: () => showWindow?.() }
  if (item.id === 'quit') return { label: item.label, click: () => app.quit() }
  return { label: item.label, enabled: false }
}

/**
 * A macOS template image: monochrome plus alpha, which the OS inverts itself
 * for light and dark menu bars. The `Template` suffix on the filename is the
 * convention, but the representations are added explicitly rather than relying
 * on `@2x` filename resolution — electron-vite emits `?asset` imports as hashed
 * filenames, so the `@2x` sibling convention does not survive the build.
 */
function trayImage(): Electron.NativeImage | null {
  const image = nativeImage.createEmpty()

  for (const [scaleFactor, path] of [
    [1, trayIcon1x],
    [2, trayIcon2x]
  ] as const) {
    if (!existsSync(path)) continue
    image.addRepresentation({ scaleFactor, buffer: readFileSync(path) })
  }

  if (image.isEmpty()) return null
  if (process.platform === 'darwin') image.setTemplateImage(true)
  return image
}
