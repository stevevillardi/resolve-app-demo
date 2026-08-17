import { Notification } from 'electron'
import { navigateTo } from './main-window'
import { getAppState } from './services/app-state'
import type { NavigateTarget } from '../shared/navigation'
import type { NotificationText } from './notification-text'

/**
 * The OS notification surface (Phase 20, review §C1).
 *
 * The one piece of iMessage the app had not copied: something happened, and
 * nothing buzzed. Everything unattended — a routine's 3 a.m. run, a ten-minute
 * turn finishing while the user is in their editor, a budget crossing — used
 * to leave only rows the user had to go look for.
 *
 * Thin on purpose, like tray.ts: the copy lives in notification-text.ts where
 * it is tested, the decisions about *when* to notify live with their callers,
 * and this module only holds the electron binding and the enabled flag.
 */

/**
 * Default ON — absence of the flag means enabled. The app's whole unattended
 * story is the reason notifications exist, so shipping them opt-in would
 * re-create the silence this phase removes; the Settings toggle is the opt-out.
 */
export function notificationsEnabled(): boolean {
  return getAppState('notifications_enabled') !== 'false'
}

/**
 * Shows one notification, or deliberately nothing.
 *
 * `Notification.isSupported()` guards platforms without a notification server;
 * the enabled flag is read per call rather than cached so the Settings toggle
 * takes effect immediately. A click focuses the app and lands on `target` via
 * the navigate channel — the same path a sidebar click takes.
 */
export function sendNotification(text: NotificationText, target?: NavigateTarget): void {
  if (!Notification.isSupported()) return
  if (!notificationsEnabled()) return

  const notification = new Notification({ title: text.title, body: text.body })
  if (target) notification.on('click', () => navigateTo(target))
  notification.show()
}
