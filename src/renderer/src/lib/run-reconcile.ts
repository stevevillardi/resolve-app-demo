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

/**
 * The symmetric half (Phase 25): active runs the store has never heard of.
 *
 * A turn the renderer did not start — a routine fire (scheduled or Run now),
 * or any turn surviving a renderer reload — has no `begin()` caller, so
 * nothing streams and the thread views render an idle conversation while
 * main is mid-turn. Sweeping these *into* the store is what makes background
 * work visible with the same machinery a sent message uses.
 *
 * A contact that already has a store entry is left alone even if the runId
 * differs — the store is keyed by contact, and clobbering an in-flight entry
 * would discard a live stream to adopt a name for the same conversation.
 */
export function missingTurnRuns(
  byContact: Record<string, { runId: string }>,
  runs: readonly { runId: string; contactId: string }[]
): { contactId: string; runId: string }[] {
  const knownRuns = new Set(Object.values(byContact).map((turn) => turn.runId))
  return runs
    .filter((run) => !knownRuns.has(run.runId) && !(run.contactId in byContact))
    .map((run) => ({ contactId: run.contactId, runId: run.runId }))
}
