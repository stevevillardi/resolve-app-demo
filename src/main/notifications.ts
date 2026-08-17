import { Notification } from 'electron'
import { navigateTo } from './main-window'
import { previewLine, routineNotification } from './notification-text'
import { getAppState } from './services/app-state'
import { getContact } from './services/contacts'
import { groupForRepo } from './services/group-messages'
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

/** What the tray shows for a routine; the toast identifies it the same way. */
const ROUTINE_NAME_MAX = 60

/**
 * A routine's outcome, every recorded status — completed, failed, *and*
 * skipped. A lock-refused 3 a.m. fire is precisely the silence this phase
 * exists to end; only fires that were never attempts (routine deleted, run
 * still going) stay quiet, because they write no history either.
 *
 * Not gated on window attention: an unattended fire is the routine's normal
 * case, and even with the app frontmost a background routine finishing is not
 * something the current screen necessarily shows.
 *
 * The click lands in the repo's group thread, where the routine_run row and
 * any PR line live — the contact thread is the fallback for a repo that has
 * no group yet.
 */
export function notifyRoutineOutcome(
  routine: { contactId: string; prompt: string },
  result: { status: 'completed' | 'failed' | 'skipped'; summary: string }
): void {
  const contact = getContact(routine.contactId)
  const group = contact ? groupForRepo(contact.repoPath) : null
  const target: NavigateTarget = group
    ? { kind: 'group', groupId: group.id }
    : { kind: 'contact', contactId: routine.contactId }

  sendNotification(
    routineNotification(previewLine(routine.prompt, ROUTINE_NAME_MAX), result),
    target
  )
}
