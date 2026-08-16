# Phase 8 — Routines & Scheduler

**Status:** Not started
**Blueprint refs:** §7 (routines), §15E (background/tray), §16 Journey 3
**Depends on:** Phase 7 (Group posting for `routine_run`), Phase 6 (concurrency lock, `AgentAdapter.run()`)

## Goal

Scheduled/unattended runs, built entirely in-app (not on any vendor's native scheduling, per blueprint §7's explicit warning about Codex's cloud-only/buggy scheduling). Includes the tray/background-residency requirement without which routines can't fire when the window is closed.

## Inherited from Phase 4 — what does and doesn't exist yet

Phase 4 created the **`routines` table only** (`drizzle/0002_add_blueprint_schema.sql`) and stopped there, deliberately. A Routine is bound to a Contact, and no Contact can exist until Phase 6, so routine CRUD would have meant shipping a create flow whose only foreign key had nothing to point at.

So everything below is still to build — none of it was partially done:

- **No IPC procedures.** `src/shared/ipc-contract.ts` has entries for skills, personas, contacts, and groups, but nothing for routines. Add `routines.list|get|create|update|delete` following the same pattern, with the entity schema in `src/shared/domain.ts` (`routineSchema` already exists and matches the table — reuse it, and add a `routineDraftSchema` for the id-less create input).
- **No service.** Add `src/main/services/routines.ts` alongside `skills.ts` / `persona-templates.ts`, which are the shape to copy.
- **`RoutineList` and `RoutineEditor` are still on mock data** (`src/renderer/src/mocks/routines.ts`), both marked with a comment pointing here. They are the last two components in the app reading mocked routines.
- **`ListPanel` has no "+" for the routines section** — Phase 4 added one for personas and skills but left routines out for the reason above. Add `newLabel: 'New routine'` to the `PANEL` map when there's somewhere to persist it.
- The table's `contact_id` is `ON DELETE CASCADE`, so deleting a Contact already takes its routines with it. Nothing extra to write for that.
- `enabled` is a Drizzle `boolean`-mode integer and `last_run_at` a `timestamp_ms`; `src/main/db/mappers.ts` already has `toRoutine` handling both conversions.

## Scope

1. **`Routine` CRUD + `RoutineEditor`**
   - Wire Phase 2's `RoutineEditor` shell to real `routines` table (Phase 4): schedule (cron expression) + prompt + enabled toggle, bound to a Contact.
   - Validate cron expressions client-side before save (clear error, not a silent bad schedule).

2. **Scheduler**
   - `node-cron` in the main process, loading all enabled `Routine`s and scheduling them from their cron expression on app startup (and re-scheduling on any create/update/delete/enable-toggle without requiring a restart).
   - On fire: acquire through Phase 6's `src/main/services/run-lock.ts`, the
     same way a user-sent message does. **Not** the `repoPath → busy` map
     blueprint §15D describes — see `00-progress.md`: the lock is a *write* lock
     keyed on the working path, so a `read_only` routine never skips at all, and
     only a *writing* routine can be refused.
   - A writing routine firing against a repo a user is actively working in is
     **the first genuine writer-vs-writer contention in the product** — a 1:1
     chat and an @mention are both things a human triggers and can see, whereas
     a routine fires unattended and will collide unannounced. It is the case
     `12-worktree-isolation.md` exists to solve: give the routine's Contact its
     own worktree and it stops competing for the user's tree entirely. If that
     phase hasn't landed, a refused routine must record *why* it skipped in
     `lastRunSummary` rather than silently doing nothing.
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
- [ ] Firing a **writing** routine while a writer holds its target repo results in a skip, with the reason recorded in `lastRunSummary` — not a concurrent run and not a silent no-op.
- [ ] Firing a **read_only** routine while a writer holds that repo runs normally: readers are never refused (Phase 6's lock semantics).

## Dependency note

Journey 3's "opens a PR" step needs Phase 9's real GitHub write actions. If Phase 9 hasn't landed yet when this phase is being worked, either sequence Phase 9 first or stub the PR step with a clear TODO and revisit Journey 3's acceptance check once Phase 9 lands.
