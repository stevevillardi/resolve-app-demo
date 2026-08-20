/**
 * The main → renderer "go here" channel.
 *
 * MENU_ACTION_CHANNEL carries a bare verb; this carries a destination. It
 * exists for notification clicks: an OS toast about a routine's 3 a.m. run has
 * to land the user in that routine's group thread, and the selection it sets
 * lives in the renderer's store. Main shows the window first (main-window.ts
 * owns that ordering), so by the time a target arrives the shell is on screen.
 *
 * In shared/ because both sides need the type; string constants only.
 */

export const NAVIGATE_CHANNEL = 'navigate'

export type NavigateTarget =
  { kind: 'contact'; contactId: string } | { kind: 'group'; groupId: string } | { kind: 'home' }
