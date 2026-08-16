# Phase 8 — Routines & Scheduler

**Status:** Not started
**Blueprint refs:** §7 (routines), §15E (background/tray), §16 Journey 3
**Depends on:** Phase 7 (Group posting for `routine_run`), Phase 6 (concurrency lock, `AgentAdapter.run()`)

## Goal

Scheduled/unattended runs, built entirely in-app (not on any vendor's native scheduling, per blueprint §7's explicit warning about Codex's cloud-only/buggy scheduling). Includes the tray/background-residency requirement without which routines can't fire when the window is closed.

## Scope

1. **`Routine` CRUD + `RoutineEditor`**
   - Wire Phase 2's `RoutineEditor` shell to real `routines` table (Phase 4): schedule (cron expression) + prompt + enabled toggle, bound to a Contact.
   - Validate cron expressions client-side before save (clear error, not a silent bad schedule).

2. **Scheduler**
   - `node-cron` in the main process, loading all enabled `Routine`s and scheduling them from their cron expression on app startup (and re-scheduling on any create/update/delete/enable-toggle without requiring a restart).
   - On fire: check the concurrency lock (Phase 6/7's `repoPath → busy` map) — skip or queue if busy, per blueprint §6/§7 (don't run in parallel).
   - Call `AgentAdapter.run(contact.session, routine.prompt)` — same code path as a user-sent message, no special "routine mode" branching in the adapter itself.
   - Result appends to the Contact's normal message history (opening the Contact shows what it did while "asleep") AND posts to the repo's Group as `routine_run`.
   - Log `UsageEvent` with `source: "routine"`.
   - Update `Routine.lastRunAt` / `lastRunSummary`.

3. **Manual "run now"**
   - Same code path as a scheduled fire, exposed as a button — blueprint §16 Journey 3 explicitly uses this for demo reliability instead of waiting on real cron timing. Make sure this really is the identical path (call through the same scheduler-fire function, don't special-case it), since the blueprint calls out this equivalence as something to be able to state truthfully if asked.

4. **Tray/background residency (blueprint §15E, hard requirement)**
   - On window close, keep the app resident via Electron's `Tray` API instead of quitting.
   - Tray menu: show window, list next-scheduled routines (compute next-fire time from each enabled Routine's cron expression), quit.
   - Confirm `node-cron` schedules genuinely keep firing with the window closed, not just minimized — test by closing the window, waiting for a scheduled fire, and checking the result appeared without reopening the window first.

5. **Governance default**
   - A Routine's Contact should default to `githubScope: "open_pr"` when created via the routine flow (or at minimum, strongly steer toward it in the UI) — unattended tasks propose via PR, not push unsupervised (blueprint §7).

6. **Optional: OS notification** on routine completion, especially if it opened a PR or flagged something needing review.

## Explicitly out of scope

- Cross-repo fan-out — one Routine is single-repo, single-prompt (blueprint §13).
- Automatic spend-threshold pausing — logging/display only in v1 (blueprint §13).

## Acceptance checks

- [ ] Blueprint §16 Journey 3 runs live: set up a routine with `githubScope: open_pr`, trigger via "run now," it reads the repo/issues, makes a change, opens a PR (verified this is a real PR via GitHub, not a push) — see Phase 9 dependency note below.
- [ ] The run posts to the Group as `routine_run`, visually distinct per Phase 2's `RoutineRunNotice`.
- [ ] `UsageEvent` with `source: "routine"` is logged and reflected in the Contact's `UsageBadge`.
- [ ] Closing the app window (not quitting) and waiting past a scheduled fire time results in the routine actually running, verified without reopening the window until after.
- [ ] Tray menu correctly lists next-scheduled routines and quit actually terminates the process.
- [ ] Firing a routine while its target repo is busy (another session active) results in a skip/queue, not a concurrent run.

## Dependency note

Journey 3's "opens a PR" step needs Phase 9's real GitHub write actions. If Phase 9 hasn't landed yet when this phase is being worked, either sequence Phase 9 first or stub the PR step with a clear TODO and revisit Journey 3's acceptance check once Phase 9 lands.
