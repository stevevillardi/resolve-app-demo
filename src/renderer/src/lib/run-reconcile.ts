/**
 * Which contacts' live turns no longer exist, according to main (Phase 11, F7).
 *
 * useRunStore learns that a turn ended from the turn's own `done` event — but
 * that event only reaches the store through a mounted subscriber, and both
 * thread views unsubscribe on unmount. A turn that finishes while the user is
 * on another screen (or the window is hidden in the tray) can therefore leak
 * its entry, which renders as a "working…" block that never resolves — the
 * live journey run watched one survive navigation, remounts, and a routine
 * fire, until an app restart.
 *
 * Main's `runs.list` is the authority on what is actually running, and it
 * announces every change on the `runs-changed` push, so the store can be
 * reconciled against it instead of trusting the event stream alone. In lib/
 * rather than the hook because this is the decision half, and the renderer
 * test project only reaches `lib/*.test.ts`.
 */
export function staleTurnContacts(
  byContact: Record<string, { runId: string }>,
  activeRunIds: readonly string[]
): string[] {
  const active = new Set(activeRunIds)
  return Object.entries(byContact)
    .filter(([, turn]) => !active.has(turn.runId))
    .map(([contactId]) => contactId)
}
