import { app } from 'electron'
import { totalUnread } from './services/unread'

/**
 * The macOS dock badge — iMessage's red number, on the app that borrowed
 * everything else from it.
 *
 * Lives in main and recomputes on the main-side messages-changed registry
 * (wired in index.ts), because the messages that most need a badge arrive
 * with no window at all: with tray residency the app runs on after close, and
 * a renderer-computed count would freeze the moment the window hid.
 *
 * `setBadgeCount(0)` clears the badge, and Electron no-ops the whole call on
 * platforms without one — no branch needed here.
 */
export function refreshDockBadge(): void {
  app.setBadgeCount(totalUnread())
}
