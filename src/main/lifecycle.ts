/**
 * Whether the app is on its way out.
 *
 * Closing the window hides it rather than destroying it, so routines keep
 * firing (blueprint §15E) and reopening is instant — no renderer reboot, no
 * splash, no `auth.getStatus` round trip. That makes "close" and "quit" two
 * different intents which the `close` event alone cannot tell apart, and this
 * flag is the difference.
 *
 * Set from `before-quit`, which both Cmd-Q and the tray's Quit reach through
 * `app.quit()` — so both really terminate, by the same path, and neither is a
 * special case of the other.
 */
let quitting = false

export function beginQuit(): void {
  quitting = true
}

export function isQuitting(): boolean {
  return quitting
}
