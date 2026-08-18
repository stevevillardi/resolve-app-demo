import { Notification } from 'electron'
import { isWindowAttended, navigateTo } from './main-window'
import {
  approvalNotification,
  previewLine,
  routineNotification,
  turnNotification
} from './notification-text'
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

/**
 * A 1:1 or mention turn that finished — but only while nobody is looking.
 *
 * The attention check lives here rather than in messaging.ts so the turn loop
 * keeps importing no electron module directly, and so its tests keep mocking
 * exactly one module for everything notification-shaped. A turn watched to
 * completion stays silent: the reply arriving on screen *is* the notification.
 *
 * Routine turns never pass through here — the scheduler notifies those with
 * the run's summary and PR context this function cannot see.
 */
/**
 * An `ask_writes` persona has a write waiting on a human (Phase 24).
 *
 * Attention-gated like notifyTurnFinished: with the window frontmost the
 * approval card is already the loudest thing on screen. Unattended is the case
 * this exists for — the ask auto-denies in minutes, so a toast the user sees
 * an hour later would be pure noise if it were the only delivery, but it is
 * the difference between catching the ask and losing it for anyone merely in
 * another app. The click lands on the contact's thread, where the card is.
 */
export function notifyApprovalRequested(
  contactId: string,
  request: { toolName: string; detail: string }
): void {
  if (isWindowAttended()) return

  const contact = getContact(contactId)
  if (!contact) return

  sendNotification(approvalNotification(contact.displayName, request.detail || request.toolName), {
    kind: 'contact',
    contactId
  })
}

export function notifyTurnFinished(input: {
  contactId: string
  origin: { kind: 'message' } | { kind: 'mention'; groupId: string }
  finalText: string
  error: string | null
}): void {
  if (isWindowAttended()) return

  const contact = getContact(input.contactId)
  if (!contact) return

  const target: NavigateTarget =
    input.origin.kind === 'mention'
      ? { kind: 'group', groupId: input.origin.groupId }
      : { kind: 'contact', contactId: input.contactId }

  sendNotification(turnNotification(contact.displayName, input.finalText, input.error), target)
}
