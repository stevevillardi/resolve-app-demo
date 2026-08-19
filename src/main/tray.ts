import { app, Menu, nativeImage, Tray } from 'electron'
import { existsSync, readFileSync } from 'fs'
import trayIdle1x from '../../resources/trayTemplate.png?asset'
import trayIdle2x from '../../resources/trayTemplate@2x.png?asset'
import trayActive1x from '../../resources/trayActiveTemplate.png?asset'
import trayActive2x from '../../resources/trayActiveTemplate@2x.png?asset'
import { listActiveRuns } from './services/messaging'
import { nextRuns } from './services/scheduler'
import { buildTrayMenu, type TrayMenuItem } from './tray-menu'
import { navigateTo } from './main-window'

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
/** Built once at startup — `addRepresentation` reads from disk. */
let icons: { idle: Electron.NativeImage; active: Electron.NativeImage } | null = null

export function createTray(onShow: () => void): void {
  if (tray) return

  const idle = trayImage(trayIdle1x, trayIdle2x)
  if (!idle) {
    // Better a missing menu-bar icon than a failed launch: everything else in
    // the app still works, and the scheduler does not depend on this at all.
    console.error('[tray] no usable tray icon; skipping the menu-bar item')
    return
  }

  // A missing badge asset should cost the badge, not the menu-bar item — so the
  // active variant falls back to idle rather than failing the same check.
  icons = { idle, active: trayImage(trayActive1x, trayActive2x) ?? idle }

  showWindow = onShow
  tray = new Tray(idle)
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

  const active = listActiveRuns()
  const runningTurns = active.length
  tray.setContextMenu(
    Menu.buildFromTemplate(
      buildTrayMenu(nextRuns(), {
        running: active.map((run) => ({
          contactId: run.contactId,
          contactName: run.contactName,
          origin: run.origin,
          groupId: run.groupId,
          startedAt: run.startedAt
        }))
      }).map(toMenuItem)
    )
  )
  // "Agents are working" without opening the menu, in two registers. The badged
  // icon is the cross-platform one, and carries in peripheral vision where a
  // digit does not; the count beside it is macOS only (`setTitle` is a no-op
  // elsewhere) and answers how many. Cleared, not '0': a zero in the menu bar
  // reads as a badge stuck on nothing.
  if (icons) tray.setImage(runningTurns > 0 ? icons.active : icons.idle)
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
  icons = null
}

function toMenuItem(item: TrayMenuItem): Electron.MenuItemConstructorOptions {
  if (item.id === 'separator') return { type: 'separator' }
  if (item.id === 'header') return { label: item.label, enabled: false }
  if (item.id === 'show') return { label: item.label, click: () => showWindow?.() }
  // "N turns running" is an invitation to look, so clicking it is Show.
  if (item.id === 'running') return { label: item.label, click: () => showWindow?.() }
  // A named run goes to its conversation — navigateTo shows and focuses first,
  // the same path a notification click takes.
  if (item.id === 'run' && item.target) {
    const target = item.target
    return { label: item.label, click: () => navigateTo(target) }
  }
  if (item.id === 'quit') return { label: item.label, click: () => app.quit() }
  return { label: item.label, enabled: false }
}

/**
 * A macOS template image: monochrome plus alpha, which the OS inverts itself
 * for light and dark menu bars. The `Template` suffix on the filename is the
 * convention, but the representations are added explicitly rather than relying
 * on `@2x` filename resolution — electron-vite emits `?asset` imports as hashed
 * filenames, so the `@2x` sibling convention does not survive the build.
 *
 * Being monochrome is also why the active variant badges the icon by *shape*
 * rather than turning a node green: colour in a template image is discarded, and
 * a non-template coloured icon would have to guess the menu bar's own
 * appearance to stay visible. See resources/tray-active.svg.
 */
function trayImage(path1x: string, path2x: string): Electron.NativeImage | null {
  const image = nativeImage.createEmpty()

  for (const [scaleFactor, path] of [
    [1, path1x],
    [2, path2x]
  ] as const) {
    if (!existsSync(path)) continue
    image.addRepresentation({ scaleFactor, buffer: readFileSync(path) })
  }

  if (image.isEmpty()) return null
  if (process.platform === 'darwin') image.setTemplateImage(true)
  return image
}
