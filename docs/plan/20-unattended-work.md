# Phase 20 — Unattended Work

**Status:** Done
**Origin:** The 2026-08-17 workflow review ("The Missing Half of the Loop"), §C — the
review's second systemic finding: *the unattended story has no delivery and no brakes.*
Routines survive a closed window via real tray residency, and then a 3 a.m. run's only
trace was a group row the user had to go look for. Not one OS notification existed in
`src/`, in an app styled after the product whose entire core loop is the notification —
blueprint §7 asked for one and it fell through every phase. Missed cron fires went to
`console.warn`. Scheduled agents spent real money unsupervised with beautiful reporting
and zero ceilings. And nothing anywhere marked what was new.

## Goal

Four review items, plus one scope addition the user chose:

1. **C1 — OS notifications.** Routine outcomes (completed / failed / skipped), turns
   finishing while the window is unattended, and budget crossings — as Electron
   `Notification`s whose click focuses the app and lands in the right conversation.
   A Settings opt-out, default ON.
2. **C2 — Missed schedules are visible.** node-cron's no-catch-up policy stands
   (Phase 8); the silence around it ends. Misses are recorded durably and surfaced in
   the routine list, the editor, and Home, with Run now as the catch-up.
3. **C3 — Budgets and alerts.** A soft monthly threshold app-wide and per routine;
   crossing one notifies once and banners on Home. Alerts only — nothing is enforced,
   stopped, or paused.
4. **C4 — Unread state.** `last_read_at` per conversation, iMessage-blue count badges
   in the sidebar, a "New messages" divider in threads, and the macOS dock badge.
5. **Recency sort** *(user decision)* — the conversation list orders by last message,
   not alphabetically; unread rows surface at the top.

## Decisions (recorded in 00-progress.md)

- **Notifications default ON**, stored as `notifications_enabled` with absence meaning
  enabled — the unattended story is the reason they exist, so shipping them opt-in
  would re-create the silence this phase removes.
- **Routine notifications cover skips too.** A lock-refused unattended fire is
  precisely the silence being ended; only fires that were never attempts (routine
  deleted, previous run still going) stay quiet, because they write no history either.
  Turn toasts are gated on window attention (`isWindowAttended()`); routine toasts are
  not — even frontmost, the current screen does not necessarily show a background fire.
- **Misses are recorded, the policy unchanged.** `missed_run_count` / `last_missed_at`
  live on the row because `syncSchedules()` re-arms handles on every edit; any recorded
  attempt clears the count (Run now is the catch-up) while the stamp survives.
- **Budget alerts trigger on the priced floor.** "At least $X of your $Y" is a true,
  actionable statement; the recordUsage seam's never-trip-a-cap rule governs
  enforcement, of which there is none. Corollary accepted: an all-unpriced month has a
  floor of $0 and never alerts. Edge-triggered once per month per scope via a sticky
  `budget_alerts_fired` map in app_state (the `github_token_state` trick), re-armed by
  the month rolling over, pruned on write.
- **`usage_events.routine_id` is not a FK** — same rule as `persona_template_id`:
  spend outlives its attribution target. Historical rows stay honestly unattributed.
- **`monthly_budget_usd` is user-editable** and therefore travels the draft/update
  shapes and `updateRoutine`'s explicit column list (pinned by test — the `model`
  omission bug); the missed-run columns are run history and appear in neither.
- **Unread null semantics:** migration 0016 backfills `last_read_at` to its own run
  time and creation stamps new rows ("born read"), so null is defensive and reads as
  everything-read — the failure mode of the other reading is a wall of stale badges on
  upgrade. Mark-read is monotonic and idempotent in the service, so racing callers can
  never un-read anything.
- **`messages-changed` is emitted from the two insert chokepoints** (`insertMessage`,
  `insertGroupMessage`), not their callers — background writes previously never
  invalidated previews at all, and a writer that can forget to announce is a badge
  that quietly lies. A main-side listener registry feeds the dock badge, which lives
  in main because the messages that most need a badge arrive with no window.
- **The unread badge is a new visual idiom** (user decision): the one iMessage-blue
  count pill in the app, deliberately distinct from `RunIndicator`'s non-badge
  treatment of run counts.
- **Recency sort replaces alphabetical** in the conversation list (user decision),
  with never-messaged rows in a stable alphabetical tail and ties broken by name.

## Testable scope

- `notification-text.ts` pure copy; `notifications.ts` against a mocked `Notification`
  class (enabled flag, isSupported, click → navigate, attention gating, targets).
- `main-window.ts` attention logic against the extended fakeWindow.
- Scheduler: outcome notifications per status, silence for non-attempts; misses
  through the widened cron port (`FakeCronEngine.missTick`), persistence across
  re-arming, Run-now clearing. `routines.ts` counters and schema exclusions.
- `budget.ts` month boundaries (local midnight of the 1st, all-unpriced, exact-cent
  crossings); `budget-alerts.ts` edge-triggering against a real `:memory:` db.
- `unread.ts` SQL counts (user rows excluded, `user_mention` excluded, boundary row
  read, null boundary, independence); markRead monotonicity.
- Renderer libs: `missedRuns`, `budgetBannerFor`, `firstUnreadIndex`, `formatBadge`,
  `byRecency`.
- E2E: the boundary advances when a thread is opened through the real UI; a routine
  budget round-trips through IPC and the migrations (`unread.spec.ts`).

## Verified

- **Screens sweep, both themes:** the budget banner in its "at least $2.15 of its
  $1.50" form with the alerts-only sentence; Home's missed-schedules section (×3,
  last-missed time); the iMessage-blue unread badge on the group row; the
  recency-sorted sidebar — and, incidentally, the whole loop: the sweep *opens* the
  first conversation, whose badge is gone in the very screenshot that shows its
  sibling's, because the mark-read effect fired through the real UI.
- **E2E (`unread.spec.ts`):** a contact is born read; opening its thread through the
  real sidebar advances `last_read_at` through real IPC and real migrations; a
  routine budget round-trips, including clearing to null rather than zero.
- **The divider** appears only on the first unread mount by design — the sweep's
  repeat visits consume it, so its placement is pinned by `firstUnreadIndex`'s unit
  cases rather than a screenshot.

## Still to eyeball on a packaged run

The visible macOS toasts and their click-through, and the dock badge digit. The
paths behind them are unit-tested end to end (copy, gating, targets, navigate
channel, badge arithmetic), but a toast on screen cannot be asserted from a test —
and a dev build attributes them to "Electron" (the running bundle is
node_modules/electron) and may need a one-time permission grant in System
Settings, which is a dev artefact to document rather than chase.
