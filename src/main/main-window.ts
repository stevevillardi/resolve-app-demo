import { BrowserWindow } from 'electron'
import { NAVIGATE_CHANNEL, type NavigateTarget } from '../shared/navigation'

/**
 * The one answer to "which window?".
 *
 * Everything that needs the window comes through here: the application menu,
 * which shows it before sending an action; `activate`, which re-creates it;
 * agent-events, pushing a stream to the renderer; notifications, deciding
 * whether anyone is looking before they buzz; and the tray and notification
 * click handlers, which must focus before they navigate. A copy of the same
 * find() in each of them is how one of them quietly diverges.
 *
 * The window is resolved per call, never cached: setupIpc() runs before
 * createWindow(), so there is nothing to capture at import time — and on macOS
 * the app outlives its window, which `activate` then re-creates. A module-level
 * reference would be stale in both directions.
 *
 * Window *creation* stays in index.ts, which owns the BrowserWindow options and
 * their reasons. It registers itself here so showMainWindow() can re-create a
 * destroyed window without this module importing half the app.
 */

let windowFactory: (() => void) | null = null

/** index.ts hands over createWindow at startup; nothing else may. */
export function setWindowFactory(factory: () => void): void {
  windowFactory = factory
}

export function getMainWindow(): BrowserWindow | null {
  return BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed()) ?? null
}

/**
 * Brings the window back, whether it was hidden or never created.
 *
 * The window count is not the test it looks like: with tray residency a hidden
 * window is still a window, so `getAllWindows().length === 0` is false after a
 * close and a naive "create if none" would do nothing at all.
 */
export function showMainWindow(): void {
  const existing = getMainWindow()
  if (!existing) {
    windowFactory?.()
    return
  }
  existing.show()
  existing.focus()
}

/**
 * Whether a person is plausibly looking at the app right now.
 *
 * "Attended" is the strictest reading — visible, not minimized, and focused —
 * because the caller that asks is deciding whether to stay quiet. An OS
 * notification for a window the user is already reading is noise; one for a
 * window that exists but sits behind the editor is the product working.
 */
export function isWindowAttended(): boolean {
  const window = getMainWindow()
  return window !== null && window.isVisible() && !window.isMinimized() && window.isFocused()
}

/**
 * Focuses the app and lands the renderer on a destination.
 *
 * Show first, send second — the same ordering the application menu uses, and
 * for the same reason: a target that lands in a hidden window looks like a
 * click that did nothing. If the factory had to create a window, the send
 * reaches a renderer that has not subscribed yet and is dropped — accepted,
 * not queued: with tray residency close *hides*, so the normal case is a live
 * window, and replaying a stale target into a fresh boot would surprise more
 * than landing on the default screen does.
 */
export function navigateTo(target: NavigateTarget): void {
  showMainWindow()
  getMainWindow()?.webContents.send(NAVIGATE_CHANNEL, target)
}
